# Spec — Gestion des campagnes (transition 2025-2026 → 2026-2027)

> **Statut : GATED.** Spec d'architecture pour validation Omar avant tout code.
> Déclencheur : **MIA** est une nouvelle variété de la campagne **2026-2027** (pas la
> campagne courante 2025-2026). Avant de la mapper, on cadre la notion de campagne.
> Investigation faite sur le code (main `9b29cef`) ET la donnée prod réelle (2026-06-14).

---

## 0. TL;DR

- **Une campagne = année fiscale Juillet→Juin**, **dérivée de la date** (`campagneOf`). BEE ONE
  n'a **aucun champ campagne** ; rien n'est saisi — tout vient de `DateStr`.
- Le **lien conso→cible est déjà versionné par campagne** (`mapping_campagne`, resolver filtre
  strict). ✅ C'est la seule brique campagne-aware propre.
- **Tout le reste est GLOBAL ou dérivé-de-date** : `parcelles_consommation`, `PARCELLE_TO_CPC`,
  `PARCELLES_CULTURALES`, liquidations, Coût Récolte. **Aucun sélecteur de campagne** dans l'app
  (on opère toujours sur la campagne de `today`). **Aucun rituel de transition.**
- **Risque principal pour MIA / 2026-2027** : `parcelles_consommation` étant global, ajouter MIA
  la ferait apparaître dans la campagne 2025-2026 (où elle n'existe pas). Et le Coût Récolte sur
  fenêtre 90j peut **mélanger deux campagnes** à la frontière juin/juillet.

---

## 1. Réponses aux 4 questions

### Q1 — Champ "campagne" sur BEE ONE (BR_Pointage) ?
**NON.** Le mirror `sql_mirror_pointage/{date}.rows[]` ne porte que :
`Periode_paie` (= "Quinzaine N"), `DateStr`, `Operation_Famille`, `Cout`, `Parcelle_Culturale`,
`Variete`, `Culture`, … **Pas de `Campagne` ni `Saison`** (vérifié sur la donnée prod).
→ La campagne est **100 % dérivée de la date**, jamais saisie.
- Dérivation : `campagneOf(dateStr)` ([resolver.js:49](../functions/lib/mappingConso/resolver.js#L49)) —
  `month >= 7 ? year : year-1` → `${startYear}-${startYear+1}`. Frontière **1er juillet**.
- Même convention côté backend `campagne-mo-variete` ([pointageService.js:2348](../functions/pointageService.js#L2348)).

### Q2 — `mapping_campagne` est-il scopé par campagne ?
**OUI, c'est la brique propre.** docId = `${campagne}__${parcelle_conso_id}`, champ `campagne`.
Le resolver **filtre strictement** : `if (campagneOf(mov.date) !== campagne) continue`
([resolver.js:206](../functions/lib/mappingConso/resolver.js#L206)). Invariant de conservation
au centime garanti par test. En prod : 19 docs, tous `2025-2026`.

### Q3 — CPC / coûts / parcelles rattachés à une campagne ?
**Majoritairement NON (global ou dérivé-de-date).**
| Élément | Scope | Détail |
|---|---|---|
| `PARCELLE_TO_CPC` / `PARCELLE_MAP` | **GLOBAL** | table statique [mappings.js:200](../functions/lib/stockCaneva/mappings.js#L200), codes CPC fixes, partagés toutes campagnes |
| `parcelles_consommation` | **GLOBAL** | champs `{id,libelle,ferme,secteur,variete,stade,famille}` — **pas de campagne** |
| `PARCELLES_CULTURALES` (front) | **GLOBAL hardcodé** | [app.jsx:2489](../public/app.jsx#L2489), cycles dérivés de date |
| Coût Récolte (CoutRecolteTab) | **DÉRIVÉ-DE-DATE** | fenêtre 7/30/60/90j ou quinzaine ; **aucun filtre campagne** |
| Coûts paie (SMAG, ancienneté, charges) | **GLOBAL** | `ouvriers_registry` + `paie_baremes` (le SMAG est daté, mais pas campagne-scopé) |
| Budget / consolidation CPC | **ABSENT** | pas d'API budget par campagne trouvée |

### Q4 — Que se passe-t-il au passage 2025-2026 → 2026-2027 ?
- **Nouvelles parcelles (MIA) isolées ?** **NON.** `parcelles_consommation` est global → MIA
  apparaîtrait dans le sélecteur magasinier **de toutes les campagnes**, y compris 2025-2026 où
  elle n'existe pas.
- **Les analyses basculent-elles automatiquement ?** **Partiellement, par dérivation de date.**
  - `mapping_campagne` + resolver : oui, basculent proprement (filtre par `campagneOf(date)`).
  - CampagneTab : suit `today` (donc bascule le 1er juillet) mais **sans sélecteur** → on ne peut
    plus consulter l'ancienne campagne.
  - Coût Récolte : **ne bascule pas** (fenêtre temporelle), et **peut mélanger** les 2 campagnes.
- **Risque de mélange ?** **OUI**, à deux endroits :
  1. **Coût Récolte fenêtre 90j à cheval sur juin/juillet** → additionne 2024-2025 + 2025-2026.
  2. **Référentiels globaux** (`parcelles_consommation`, `PARCELLES_CULTURALES`) → une parcelle/
     variété arrêtée ou nouvelle n'est pas isolée par campagne.
- **Rituel de transition ?** **AUCUN.** Pas de seed nouvelle campagne, pas d'archive campagne, pas
  de bascule. (Il existe un `archiveQuinzaines` mais c'est par **quinzaine**, pas par campagne —
  [sqlSyncService.js:521](../functions/sqlSyncService.js#L521).)

---

## 2. État actuel — synthèse

```
campagne = f(date)  ──►  campagneOf()  (Jul→Jun, frontière 1er juillet)
                              │
          ┌───────────────────┼─────────────────────────────┐
   CAMPAGNE-AWARE          DÉRIVÉ-DE-DATE                  GLOBAL
   (propre)               (bascule auto le 1/7)         (pas de campagne)
   • mapping_campagne      • CampagneTab (today)          • parcelles_consommation
   • resolveCharges()      • Coût Récolte (fenêtre)       • PARCELLE_TO_CPC / PARCELLE_MAP
                           • Cycle C1/C2 (getCycle)       • PARCELLES_CULTURALES
                                                          • liquidations (année calendaire)
                                                          • paie_baremes / ouvriers_registry
                                                          • budget / CPC (absent)
```

**Conclusion** : l'architecture campagne est **embryonnaire**. Une seule brique (le mapping conso)
est correctement versionnée ; tout le reste suppose implicitement « une seule campagne = la
courante ». Ça tient tant qu'on ne vit qu'UNE campagne à la fois, mais **casse à la transition**
(consultation de l'historique, isolation des nouvelles variétés, analyses à cheval).

---

## 3. Risques concrets pour 2026-2027

| # | Risque | Impact | Où |
|---|---|---|---|
| R1 | MIA (nouvelle variété 26-27) visible en 25-26 | Magasinier voit/saisit une parcelle inexistante cette campagne | `parcelles_consommation` global |
| R2 | Coût Récolte fenêtre 60/90j mélange 2 campagnes | KPIs/CPC faux à la frontière juin/juillet | CoutRecolteTab sans filtre campagne |
| R3 | Pas de sélecteur campagne | Impossible de consulter 25-26 une fois en 26-27 | CampagneTab, Coût Récolte, Mapping |
| R4 | Pas de CPC pour MIA | Conso MIA → `nonResolu` (n'atteint pas le CPC) | `PARCELLE_TO_CPC` global, pas d'entrée MIA |
| R5 | Pas de rituel de transition | Démarrage 26-27 manuel/risqué, pas d'archive 25-26 | aucun script rollover |
| R6 | Liquidations non campagne-taggées | Reporting Driscoll's pas isolable par campagne | `liquidations` (year calendaire) |

---

## 4. Ce qui manque pour gérer proprement 2026-2027

1. **Scoper `parcelles_consommation` par campagne** : soit un champ `campagnes: ['2025-2026', …]`
   (multi-campagne, une parcelle pérenne y est dans plusieurs), soit `campagne_debut` / `actif`.
   → isole MIA en 2026-2027.
2. **Un sélecteur de campagne global** (état app), défaut = campagne de `today`, propagé aux
   écrans : Coût Récolte, Campagne, Mapping conso, sélecteur parcelle magasinier.
3. **Filtrer les analyses temporelles par campagne** : Coût Récolte ne doit jamais agréger une
   fenêtre à cheval sur deux campagnes (borner la fenêtre à la campagne sélectionnée).
4. **Référentiel CPC extensible par nouvelle variété/parcelle** : ajouter MIA (et futures) à
   `PARCELLE_TO_CPC` avec un `cpc_code` décidé. Le code reste global (les codes CPC sont stables),
   mais l'**activation** d'une parcelle est portée par campagne (via mapping_campagne + parcelles_consommation scopées).
5. **Un rituel "nouvelle campagne"** : (a) seed `mapping_campagne` pour 26-27 (copie adaptée de
   25-26 + nouvelles parcelles), (b) marquer les parcelles actives 26-27, (c) archiver/figer 25-26.
6. **(Optionnel) Tag campagne sur liquidations** : champ `campagne = campagneOf(date)` à
   l'ingestion, pour un reporting campagne-scopé.

---

## 5. Plan proposé (par phases — chaque phase = un GO séparé)

> Recommandation forte : **garder la dérivation par date** (`campagneOf`) comme source de vérité.
> Ne PAS demander un champ Campagne à BEE ONE (dépendre d'une saisie externe = fragile ;
> la date est fiable et déjà là). On promeut `campagneOf` en utilitaire partagé front+back.

**Phase 0 — Fondations (petit, sûr)**
- Extraire `campagneOf` en util partagé (front `public/lib/` + back) — une seule définition.
- Ajouter un **état "campagne sélectionnée"** au niveau app (défaut = `campagneOf(today)`) +
  un **dropdown campagne** réutilisable (liste = campagnes ayant de la donnée : dérivée des dates
  mirror + des mapping_campagne existants).

**Phase 1 — Scoper le référentiel magasinier**
- Ajouter `campagnes: string[]` à `parcelles_consommation` (rétro-rempli `['2025-2026']` pour les 19).
- Le sélecteur parcelle magasinier (mag_bc) filtre par campagne sélectionnée.
- MIA : créée uniquement avec `campagnes: ['2026-2027']` → invisible en 25-26. (débloque le cas MIA proprement.)

**Phase 2 — Analyses campagne-bornées**
- Coût Récolte : la fenêtre temporelle est **bornée à la campagne sélectionnée** (jamais à cheval).
- CampagneTab : ajouter le sélecteur (consulter 25-26 depuis 26-27).

**Phase 3 — CPC nouvelle variété**
- Ajouter MIA à `PARCELLE_TO_CPC` (`'S9 Mia F5'` → `cpc_code` à décider, ferme F5). Décision Omar.
- Seed `mapping_campagne` 2026-2027 (parcelles actives 26-27, dont MIA mappée).

**Phase 4 — Rituel de transition (outillage)**
- Script "ouvrir campagne N+1" : seed mapping_campagne N+1, marquer parcelles actives, archiver N.
- (Optionnel R6) tag `campagne` sur liquidations à l'ingestion.

---

## 6. Décisions à trancher par Omar (avant code)

1. **Modèle de scoping parcelles** : `campagnes: []` (multi, recommandé pour les pérennes comme
   avocatier) **vs** `campagne_debut`/`campagne_fin` ? → je recommande `campagnes: string[]`.
2. **Source de vérité campagne** : confirmer **dérivation par date** (recommandé) vs demander un
   champ Campagne à BEE ONE.
3. **CPC de MIA** : MIA (S9 F5, framboise) → quel `cpc_code` ? nouveau `S9_MIA` ? rattaché à un
   CPC existant ? (MIA absente du canevas actuel.)
4. **Périmètre Phase 1 immédiat** : se limite-t-on à débloquer MIA (scoper parcelles_consommation +
   sélecteur), ou on embarque tout de suite le sélecteur campagne global (Phase 0+1+2) ?

---

## 7. Recommandation immédiate pour MIA

Ne **pas** ajouter MIA au mapping 2025-2026 (ce serait faux). MIA appartient à 2026-2027.
Le déblocage minimal propre = **Phase 0 + Phase 1** : sélecteur campagne + `parcelles_consommation`
scopées par campagne, puis créer MIA en `campagnes: ['2026-2027']` avec son CPC (décision Q6.3).
Tant que ce n'est pas fait, MIA reste **sélectionnable mais non mappée** (statut `a_creer`, conso
en `nonResolu`) — sans polluer la campagne courante.

---

## 8. ADDENDUM — précisions Omar (2026-06-14)

### 8.1 MIA arrive AUTOMATIQUEMENT de BEE ONE (pas de saisie manuelle)
Dès qu'il y a du pointage/récolte sur une parcelle MIA dans BR_Pointage, elle apparaît dans
`sql_mirror_pointage/{date}.rows[].Parcelle_Culturale` avec sa date. `campagneOf(date)` dérive
2026-2027 si la date ≥ 2026-07-01. **Le système ne doit donc pas attendre une saisie : il doit
DÉTECTER les nouvelles parcelles inconnues qui arrivent du mirror.** (Le `parcelles_consommation`
côté magasinier reste, lui, une liste curée manuelle — voir 8.4.)

### 8.2 Modèle PARCELLES × PROFIL (état actuel)
Deux dimensions parcelle COEXISTENT, scopées différemment selon le profil :

| Profil | Dimension parcelle | Scoping actuel | Source |
|---|---|---|---|
| **Magasinier** | `parcelles_consommation` (sa liste curée) | les 19 (filtre campagne ajouté en cours) | Firestore `parcelles_consommation` |
| **Stationnaire fX** | récolte/irrigation de SA ferme | `farm` du profil (`stationnaire_f1`→F1, `_f5`→F5, `_avo`→F2 + switchableFarms F2/F3/F4/F6/BAHIA) | parcelles BEE ONE filtrées ferme |
| **Chef fX** | parcelles de SA ferme | `farmFilter = profileData.farm` ([app.jsx:3005](../public/app.jsx#L3005), `&ferme=${farmFilter}`) | `parcelleConfig[ferme]` / `/api/parcelles?ferme=` |
| **DG / RH / Dir. Technique** | toutes | aucun filtre (dt: switchableFarms = toutes) | tout |

**Constat clé** : la dimension parcelle du **récolte/pointage** (stationnaire, chef, DG) vient
**directement de BEE ONE** (`Parcelle_Culturale`, filtrée par ferme via le profil). La dimension
**stock/consommation** (magasinier) est `parcelles_consommation` (curée). Ce sont **deux référentiels
distincts** qui doivent tous deux être campagne-aware.

→ **MIA (S9 F5, framboise)** apparaîtra donc **automatiquement** chez : **Stationnaire F5, Chef F5,
DG/RH** (côté récolte BEE ONE, dès le pointage), ET dans la liste **Magasinier** (côté stock conso,
scopée 2026-2027). Le spec doit garantir qu'elle apparaisse **au bon endroit, à la bonne campagne**.

### 8.3 MÉCANISME DE DÉTECTION des nouvelles parcelles BEE ONE non mappées (cœur de la transition)
Au lieu d'un mapping 100 % statique, on ajoute une **détection automatique** :

1. **Scan** (job planifié, ex. après chaque sync mirror) : extraire les `Parcelle_Culturale`
   distinctes du mirror, avec leur 1ère date vue → `campagneOf(date)`.
2. **Diff vs le référentiel de résolution CPC** : une parcelle est « inconnue » si elle ne résout
   pas vers un CPC. ⚠️ **Important** (corrige mon 1er test) : il y a DEUX résolveurs selon le
   domaine — **stock** via `PARCELLE_TO_CPC`/`PARCELLE_MAP` (canevas), **récolte** via
   `normalizeParcelle`/`DESIGNATION_MAP` (app.jsx ~2561). La détection doit tourner contre le
   résolveur de la consolidation CPC visée (à **unifier** — voir 8.5). *(Mon scan brut a trouvé 24/28
   `Parcelle_Culturale` absentes de la table STOCK canevas — normal, le canevas est un sous-ensemble
   curé ; ça illustre justement pourquoi il faut le BON référentiel de résolution, pas un comptage
   naïf.)*
3. **File d'attente** : écrire les inconnues dans une collection `parcelles_a_mapper`
   `{ parcelle, campagne, premiere_date, ferme, variete, culture, statut:'a_mapper', detecte_le }`.
4. **Notification** : WhatsApp/in-app à Omar : « Nouvelle parcelle détectée : <parcelle>, campagne
   <X>, à mapper vers un CPC » (réutiliser `functions/notifyOmar.js`).
5. **CPC "NON AFFECTÉ"** : tant qu'une parcelle est `a_mapper`, ses coûts vont dans un bucket CPC
   dédié `NON_AFFECTE` (ni perdus, ni mélangés à un autre CPC). Le resolver route `cpcResolver(p)===null`
   → `NON_AFFECTE` (au lieu de l'ignorer/`nonResolu`). Omar mappe → les coûts basculent au bon CPC.

→ **Résultat** : quand MIA arrive (2026-2027), elle est **auto-détectée**, **flaggée**, Omar reçoit
l'alerte, ses coûts sont **isolés en NON_AFFECTE**, et un simple mapping (Omar décide `S9_MIA`) les
bascule. **Zéro perte, zéro mélange, zéro casse.**

### 8.4 MIA dans `parcelles_consommation` (magasinier) — scoping campagne
- MIA reste dans `parcelles_consommation` (déjà : doc `c4` « S9 - MIA F5 », champ
  **`campagnes: ['2026-2027']`** écrit le 2026-06-14). Pas stationnaire.
- **DÉCISION (réponse à ta question)** : le sélecteur magasinier **filtre par campagne active**
  (`(c.campagnes||[]).includes(campagneSélectionnée)`, défaut = `campagneOf(today)`).
  - En **2025-2026** → les 18 (MIA cachée). En **2026-2027** → MIA + pérennes reportées, sans les
    parcelles disparues. C'est ton modèle « il voit les parcelles de cette campagne ».
  - Option « anticipation » possible : un toggle « voir campagne suivante » si le magasinier doit
    saisir des consos d'établissement avant le 1/7 — à décider (sinon: ajouter `'2025-2026'` au tableau
    `campagnes` de MIA pour la rendre visible en établissement, grâce au modèle multi).
- **Pérennes (avocat, myrtille)** : `campagnes: []` multi → au rituel d'ouverture 2026-2027, on
  **ajoute** `'2026-2027'` à leur tableau (pas de duplication).

### 8.5 Rituel de transition (1er juillet) — ce que ça doit faire
- **Bascule par défaut** : `campagneOf(today)` passe à 2026-2027 le 1/7 → le sélecteur global pointe
  par défaut sur la nouvelle, **les deux restent consultables** via le dropdown.
- **Ouverture campagne N+1** (script outillé) : (a) ajouter `'2026-2027'` aux `campagnes` des
  parcelles pérennes encore actives ; (b) la détection 8.3 remonte automatiquement les nouvelles
  (MIA) en `parcelles_a_mapper` ; (c) `mapping_campagne` 2026-2027 se construit au fil des mappings
  validés ; (d) figer/archiver 2025-2026 (lecture seule). **Aucune copie aveugle** : on reporte
  explicitement ce qui continue, on détecte ce qui est nouveau.
- **Bornage analyses** : Coût Récolte (et toute fenêtre temporelle) est **borné à la campagne
  sélectionnée** — jamais de fenêtre 60/90j à cheval juin/juillet additionnant 2 campagnes.

### 8.6 Plan révisé (Phase 0+1 — GO Omar)
- **Phase 0** : `campagneOf` util partagé front+back ; état « campagne sélectionnée » (défaut today).
- **Phase 1a (milestone à montrer AVANT le sélecteur global)** :
  - `parcelles_consommation.campagnes[]` (fait) + sélecteur magasinier **filtré par campagne**.
  - **Détection 8.3** : job de scan + collection `parcelles_a_mapper` + notif + bucket `NON_AFFECTE`.
  - Démo sur MIA (simulée si pas encore en BEE ONE) : détectée → flaggée → coûts en NON_AFFECTE.
- **Phase 1b** : sélecteur campagne **global** (Coût Récolte borné, CampagneTab, Mapping).
- **Phase 2+** : unifier les résolveurs récolte/stock (8.5), rituel d'ouverture, tag campagne liquidations.

---

## 9. MODÈLE D'AFFECTATION CAMPAGNE — cutoff par variété (validé Omar 2026-06-14)

Remplace la frontière fiscale fixe (30 juin) par un **cutoff campagne PAR VARIÉTÉ, modifiable**.

### 9.1 Principe & structure
- **Défaut** : 30 juin (frontière fiscale standard) → `campagneOf(date)` inchangé.
- **Surcharge** : une variété peut avoir un cutoff antérieur (ex. MIA démarre mai 2026 → ses charges
  basculent sur 2026-2027 avant le 30 juin).
- Config Firestore `config/campagne_cutoffs` (ou champ sur un futur référentiel variété) :
  ```
  { variete: "MIA",  cutoff_campagne: "2026-05-01", campagne_cible: "2026-2027" }
  { variete: "Maravilla Green Cane", cutoff_campagne: "…", campagne_cible: "…" }
  ```

### 9.2 Règle de résolution (le plus spécifique gagne)
Nouvelle fonction `campagneOfCharge({ date, variete, ferme/parcelle })` :
1. **Cutoff le plus spécifique applicable** (voir 9.3) avec `date >= cutoff_campagne` → `campagne_cible`.
2. **Sinon** → dérivation standard `campagneOf(date)` (30 juin).
La dérivation par date reste le **socle** ; le cutoff est une surcharge ciblée.

### 9.3 Réponse — variété GLOBALE vs variété × parcelle ?
**Recommandation : supporter les DEUX niveaux, le plus spécifique gagne.**
Ordre de résolution d'un cutoff pour une charge `(variete, ferme, parcelle, date)` :
`cutoff(variete + parcelle)` > `cutoff(variete + ferme)` > `cutoff(variete)` > défaut 30 juin.
- Ça couvre ton cas « Maravilla Long Cane F1 vs F5 cutoffs différents » (clé `variete+ferme`).
- Si tu veux rester simple au début : ne gérer que `variete` (global), et ajouter la dimension
  `+ferme/parcelle` plus tard. **À trancher** (voir 9.6).

### 9.4 Réponse — changement de cutoff RÉTROACTIF, charges déjà imputées ?
**Principe clé : la campagne d'une charge n'est JAMAIS stockée sur la charge — elle est DÉRIVÉE
à la consolidation** (le resolver lit `stock_movements`/récolte et calcule `campagneOfCharge`).
Donc :
- Changer un cutoff → **recalcul automatique** à la prochaine consolidation CPC / au prochain
  affichage. **Aucune migration de données** (rien à réécrire sur les mouvements).
- ⚠️ **Effet de bord** : des charges déjà **consolidées/communiquées** (CPC d'une campagne déjà
  figée, reporting envoyé) peuvent basculer. → ajouter (a) un **audit log** de tout changement de
  cutoff `{variete, ancien, nouveau, par, le}`, (b) une **alerte** « N charges (M DH) basculées de
  <campagne A> vers <campagne B> » au moment du changement, (c) **invalider les caches CPC**
  matérialisés concernés. Une campagne **figée/archivée** (rituel 8.5) devrait **verrouiller** ses
  cutoffs (changement → warning explicite « campagne clôturée »).

### 9.5 Réponse — cutoff sur charges (CPC) SEULEMENT ou aussi récolte (Coût Récolte) ?
**Les DEUX, via une source de vérité unique.** `campagneOfCharge` est utilisée par :
- le **resolver CPC** (attribution des charges stock au CPC d'une campagne),
- le **bornage Coût Récolte** (les kg/coûts récolte d'une parcelle MIA en mai-juin 2026 comptent en
  2026-2027, pas en 2025-2026).
Sinon incohérence : la récolte MIA serait en 25-26 et ses charges en 26-27. **Une seule fonction**
partagée front+back garantit que récolte et charges d'une même variété tombent dans la même campagne.

### 9.6 Interface (Paramètres)
Écran « Cutoffs campagne » (onglet Paramètres RH, à côté des barèmes) : tableau
**Variété | (Ferme/Parcelle si niveau fin) | Cutoff défaut (30 juin) | Cutoff personnalisé | Campagne cible**,
modifiable. Écriture via Cloud Function (gouvernance : pas d'écriture client directe sur `config/`).
Chaque modification → audit log + alerte 9.4.

### 9.7 Articulation avec le reste du spec
- `campagneOfCharge` **remplace/enveloppe** `campagneOf` partout où on attribue une charge/récolte à
  une campagne (resolver, bornage Coût Récolte, détection 8.3 pour dater la 1ère apparition d'une
  variété).
- Le champ `parcelles_consommation.campagnes[]` (8.4) reste la **visibilité** du sélecteur magasinier
  (UX) ; il PEUT être dérivé des cutoffs plus tard, mais les deux concepts sont distincts :
  *cutoff = à quelle campagne appartient une charge ; campagnes[] = dans quel sélecteur la parcelle est visible.*

### 9.8 Points encore à trancher (9.6)
1. Niveau du cutoff au lancement : **variété seule** (simple) ou **variété × ferme/parcelle** (fin) ?
2. CPC de MIA : `S9_MIA` ? (à confirmer agronomie).
3. Verrouillage des cutoffs sur une campagne archivée : warning seul, ou interdiction ?

---

## 10. MODÈLE FINAL VALIDÉ (Omar 2026-06-14) — fait foi, supersede les points ouverts de §9

### 10.1 Cutoff par PARCELLE (clé = variété + parcelle)
- **Clé du cutoff = la parcelle** (granularité fine, pas la variété globale). Une parcelle =
  une ligne `Parcelle_Culturale` BEE ONE.
- **Défaut : 30 juin** (frontière fiscale). **Surchargeable par parcelle** : une date unique
  `cutoff_campagne` + `campagne_cible`.
- **Affecte les CHARGES uniquement, JAMAIS la récolte.** Justification : au moment du cutoff
  (établissement), la parcelle ne produit pas encore → il n'y a **pas de récolte au cutoff**. La
  récolte arrive plus tard et tombe naturellement dans la bonne campagne par date.
- **TOUTES les charges** concernées : main d'œuvre (MO), stock (intrants), transport, etc.
- Résolution : `campagneDeCharge({ parcelle, date })` =
  `si cutoff(parcelle) défini ET date >= cutoff_campagne → campagne_cible ; sinon campagneOf(date)`.
  (Plus de niveau variété-global : **la clé est la parcelle**, donc « Maravilla Long Cane F1 vs F5 »
  = deux parcelles, deux cutoffs possibles — naturellement géré.)

### 10.2 Bi-cycle = parcelles DISTINCTES (pas de notion "cycle" dans le modèle)
- Primocane (cycle 1) et Floricane (cycle 2) sont **deux `Parcelle_Culturale` séparées** dans BEE ONE.
- Chaque parcelle porte **SA superficie** (→ coût/ha correct par cycle), **SON cutoff**, **SA campagne**.
- Conséquence : **on n'a pas besoin d'une dimension `cycle`** — *la parcelle EST le cycle*. Le modèle
  campagne raisonne uniquement par parcelle. (Simplifie : pas de logique C1/C2 à scoper par campagne.)

### 10.3 Recalcul rétroactif si changement de cutoff — APERÇU + validation (jamais silencieux)
- La campagne d'une charge **n'est jamais stockée** : dérivée à la consolidation via `campagneDeCharge`.
- Changer un cutoff de parcelle → **APERÇU avant/après obligatoire** : « X charges, Y DH passent de
  <campagne A> à <campagne B> ». **Omar valide explicitement** avant application. **Jamais de bascule
  silencieuse.** Après validation : audit log + invalidation des caches CPC concernés.

### 10.4 CPC "EN CONSTRUCTION" — campagne future consultable dès maintenant
- La campagne **2026-2027 est consultable immédiatement** (avant son démarrage officiel).
- Indicateur dédié : **« Charges pré-campagne engagées : X DH »** = suivi **temps réel de
  l'investissement d'établissement** (MIA et autres parcelles déjà en cutoff 2026-2027).
- Les charges pré-campagne (avant production) s'accumulent dans le CPC 2026-2027 « en construction »,
  isolées de 2025-2026.

### 10.5 Sélecteur campagne GLOBAL — cohérent avec les cutoffs
- État app « campagne sélectionnée » (défaut = campagne du jour), propagé à tous les écrans.
- **2025-2026** → ne montre **PAS** MIA ni les parcelles dont le cutoff/campagne = 2026-2027.
- **2026-2027** → montre MIA + les charges pré-campagne engagées.
- La **visibilité** d'une parcelle dans une campagne dérive de son affectation (cutoff → campagne_cible
  pour les nouvelles ; date sinon). Le champ `parcelles_consommation.campagnes[]` (8.4) est la forme
  matérialisée de cette visibilité côté magasinier ; il doit rester **cohérent avec les cutoffs**
  (idéalement dérivé d'eux, pas saisi en double).

### 10.6 Détection auto nouvelles parcelles BEE ONE (confirme §8.3)
- Nouvelle parcelle inconnue (absente du mapping de résolution CPC) → **flaggée « à mapper »** dans
  `parcelles_a_mapper` + **alerte** Omar (WhatsApp/in-app).
- Ses charges **en attente** dans un CPC **`NON_AFFECTE`** : ni perdues, ni mélangées. Omar mappe →
  bascule au bon CPC.

### 10.7 Interface Paramètres — Cutoffs par parcelle
- Écran (onglet Paramètres) : tableau **Parcelle | Ferme | Cutoff défaut (30 juin) | Cutoff perso |
  Campagne cible**, modifiable par Omar à tout moment.
- Écriture via Cloud Function (gouvernance : pas d'écriture client sur `config/`). Chaque modif →
  aperçu 10.3 + audit log.

### 10.8 Plan d'implémentation (Phase 0+1, sur GO Omar)
- **Phase 0** : `campagneDeCharge({parcelle,date})` + `campagneOf(date)` en util partagé front+back
  (lit `config/campagne_cutoffs`). État « campagne sélectionnée » global (défaut = campagne du jour).
- **Phase 1a (milestone, déjà en preview)** : sélecteur magasinier filtré par campagne (visibilité).
- **Phase 1b** : 
  - Collection `config/campagne_cutoffs` + écran Paramètres (CRUD via CF, aperçu avant/après).
  - Sélecteur campagne **global** (Coût Récolte borné, CampagneTab, Mapping).
  - CPC « en construction » 2026-2027 + indicateur charges pré-campagne.
- **Phase 1c** : détection auto BEE ONE (job scan + `parcelles_a_mapper` + notif + bucket `NON_AFFECTE`).
- **Phase 2** : rituel d'ouverture campagne (report pérennes, archivage/verrou 25-26), tag campagne liquidations.

> Note : §9 (cutoff par variété, cutoff sur récolte aussi) est **superseded** par §10
> (cutoff par parcelle, charges uniquement). §10 fait foi.

### 10.9 Timing du défaut & fenêtre pré-campagne (précision Omar 2026-06-14)
- **Défaut = `campagneOf(today)`** (jamais en dur). **Bascule automatique le 1er juillet** :
  le 2026-07-01, `campagneOf(today)` passe à `2026-2027` → le sélecteur pointe par défaut dessus.
- **Fenêtre pré-campagne (dès mai)** : la campagne **suivante** (N+1) devient **DISPONIBLE** dans le
  sélecteur **~2 mois avant le 1er juillet** (dès mai), pour saisir les **charges d'établissement**,
  tout en restant **NON-défaut** jusqu'au 1er juillet. Concrètement, N+1 apparaît dès qu'une
  parcelle/cutoff la cible (ex. cutoff MIA mai 2026 → `2026-2027` visible dès mai 2026 ; à partir de
  mai 2027 → `2027-2028` émerge de la même façon).
- **« Créer » une campagne** n'est pas un acte manuel : elle **émerge** des cutoffs / de la détection
  auto BEE ONE (§10.6) dès que ses 1ères charges d'établissement arrivent. Pas de seed vide à l'avance.
- Liste des options du sélecteur = `{ campagnes ayant des données } ∪ { campagne du jour } ∪
  { campagne suivante si on est dans la fenêtre pré-campagne (≥ 1er mai) }`, triée.

---

## 11. MODÈLE PHASE — bi-cycle framboise (RAFFINEMENT MAJEUR, Omar 2026-06-14)

> **Supersede §10.2.** Le bi-cycle framboise n'est **PAS** deux parcelles séparées : c'est **UNE
> parcelle physique avec DEUX phases temporelles datées** (Primocane / Floricane).
> Référentiel 2026-2027 : `docs/Parcelles_2026-2027_BGF.xlsx` (14 parcelles physiques).

### 11.1 Principe — une parcelle, deux phases datées
- **Primocane** : phase active **AVANT** le 1er janvier.
- **Floricane** : phase active **À PARTIR DU** 1er janvier.
- **Bascule automatique au 1er janvier**, **date configurable par parcelle** (`bascule_date`).
- `phaseDeCharge({ parcelle, date })` = `date < bascule_date ? 'primocane' : 'floricane'`.

### 11.2 La bascule change 3 choses d'un coup (sur une même parcelle physique)
| | Avant bascule (Primocane) | Après bascule (Floricane) |
|---|---|---|
| **Libellé** | « X Primocane » | « X Floricane » |
| **Superficie** | ex. Maravilla GC **2,5 ha** | ex. **5 ha** |
| **Bucket CPC** | `<CPC>_PRIMO` | `<CPC>_FLORI` |

### 11.3 Affichage magasinier (et sélecteurs) — phase active uniquement
- Ne montre **QUE la phase active** à la date courante. Primocane **caché après** le 1er janvier,
  Floricane **caché avant**. Le magasinier ne voit **jamais** 2 phases (suivi simplifié).

### 11.4 CONSERVATION HISTORIQUE — NON NÉGOCIABLE ⚠️
- L'affichage ne montre qu'une phase, **mais les DONNÉES DES DEUX PHASES sont conservées EN
  PERMANENCE**. Les **deux buckets CPC** (`_PRIMO` et `_FLORI`) **coexistent toujours**.
- Les charges **Primocane** (avant 1er janv) restent dans le bucket **Primo POUR TOUJOURS**, même
  quand l'affichage passe en Floricane. **Aucune donnée écrasée à la bascule.**
- La bascule change **l'AFFICHAGE** et le **ROUTAGE des NOUVELLES charges** — **jamais l'historique
  existant**.
- On peut consulter la **rentabilité des DEUX cycles à tout moment**, indépendamment de la phase
  affichée. L'historique **survit aux campagnes** (CPC Primo/Flori 2026-2027 consultable en 2027-2028
  → comparaison inter-campagnes).
- **Implémentation garante** : le bucket CPC d'une charge est **dérivé de SA date** via
  `phaseDeCharge(parcelle, charge.date)` — déterministe, immuable. Une charge ne « migre » jamais de
  bucket : sa date fige sa phase. La bascule ne fait que (a) changer la phase affichée et (b) router
  les nouvelles charges (dont la date est ≥ bascule) vers `_FLORI`. **Rien n'est recalculé ni effacé
  rétroactivement sur les charges passées.**

### 11.5 Cutoff CAMPAGNE vs bascule PHASE — deux routages distincts
Deux dérivations date→dimension **indépendantes**, sur la même parcelle :
- `campagneDeCharge(parcelle, date)` (§10) : **quelle campagne** (cutoff, défaut 30 juin).
- `phaseDeCharge(parcelle, date)` (§11) : **quelle phase** (bascule, défaut 1er janvier).
- Une charge → **(campagne, phase)** → bucket CPC `<cpc>_<phase>` **dans** cette campagne.
- Exemple TP (MIA, Yasmin) : cutoff campagne avancé **mai 2026** (charges d'établissement →
  **2026-2027**) ; Floricane démarre **1er janvier 2027**. **Les deux phases → campagne 2026-2027.**

### 11.6 Cultures SANS phase
- **Avocat** (pérenne) : **phase unique**, pas de Primo/Flori, pas de bascule.
- **Myrtille C1/C2** : **années de production** (1re / 2e), **PAS** des phases intra-annuelles →
  **parcelles distinctes**, **pas de bascule** au 1er janvier.

### 11.7 Modèle de données proposé (référentiel parcelle 2026-2027)
Collection `parcelles_culturales_ref` (ou extension du référentiel existant), **une doc par parcelle
physique** :
```
{
  id, libelle_base, ferme, culture, variete,
  campagne: "2026-2027",
  cutoff_campagne?: "2026-05-01",       // §10, optionnel (TP établissement)
  phase: {                               // présent si bi-cycle framboise, absent sinon
    bascule_date: "2027-01-01",
    primocane:  { libelle, superficie_ha, cpc_bucket },
    floricane:  { libelle, superficie_ha, cpc_bucket }
  } | null,                              // null = culture sans phase (avocat, myrtille)
  superficie_ha?                          // si pas de phase (avocat/myrtille)
}
```
- Résolution d'une charge `(parcelle, date)` → `campagne = campagneDeCharge`, `phase =
  phase ? phaseDeCharge : 'unique'`, `cpc_bucket = phase.<phase>.cpc_bucket || cpc_base`.

### 11.8 Les 14 parcelles 2026-2027 (détail dans l'Excel — à valider équipe)
- **Avocat (5)** : F2–F6 Hass, 30,5 ha total, **phase unique**.
- **Framboise (4 bi-cycle)** : Maravilla LC (2→4 ha), Maravilla GC (2,5→5 ha), MIA (0,6→0,6 ha, TP),
  Yasmin (2,3→2,3 ha, TP). *(superficie Primocane→Floricane)*
- **Myrtille (5)** : Breeze C1/C2, Cascade C1/C2, Corina C2 — **parcelles distinctes, pas de bascule**.

### 11.9 Impacts implémentation (à intégrer en Phase 0+1)
- `phaseDeCharge` partagé front+back (à côté de `campagneDeCharge`).
- Sélecteurs (magasinier + récolte) : afficher la phase active uniquement.
- Resolver CPC : router vers `<cpc>_<phase>` par date ; **garantir l'immuabilité** des buckets passés.
- Consolidation/affichage CPC : exposer Primo **et** Flori séparément, toujours, toutes campagnes
  (vue rentabilité par cycle).

### 11.10 Validation du modèle §11 contre `docs/Parcelles_2026-2027_BGF.xlsx` (lu 2026-06-14)
Le modèle PHASE est **confirmé par l'Excel** (3 feuilles : Parcelles / Récap superficies / À valider).
Précisions tirées de la donnée :
- **CPC par phase explicites** (colonnes « CPC Primocane » / « CPC Floricane ») :
  - Avocat (phase unique) : `F2_HASS … F6_HASS` (CPC Flori vide).
  - Maravilla LC : `F1_MARAVILLA_LC_PRIMO` / `F1_MARAVILLA_LC_FLORI` (2→4 ha).
  - Maravilla GC : `F1_MARAVILLA_GC_PRIMO` / `F1_MARAVILLA_GC_FLORI` (2,5→5 ha).
  - **MIA** : **`F5_MIA_PRIMO` / `F5_MIA_FLORI`** (TP, cutoff Primo **mai 2026**) → **résout la question
    « CPC de MIA »** : ce n'est pas un `S9_MIA` unique, mais **deux buckets datés par phase**.
  - Yasmin : `F5_YASMIN_PRIMO` / `F5_YASMIN_FLORI` (TP, cutoff Primo mai 2026).
  - Myrtille C1/C2 (phase unique) : `F5_BREEZE_C1`, `F5_BREEZE_C2`, `F5_CASCADE_C1`, `F5_CASCADE_C2`, `F5_CORINA_C2`.
- **Colonne `Cutoff charges`** par parcelle : « 30 juin » par défaut ; « Primo: mai 2026 / Flori: 1er janv »
  pour les TP (MIA, Yasmin) → aligne §10 (cutoff campagne) + §11 (bascule phase).
- **À corriger à la validation équipe** : la feuille tague **Yasmin en `Culture=Myrtille`** alors que
  c'est une **framboise (TP)** — coquille à confirmer/corriger (feuille « À valider »). Le Récap compte
  d'ailleurs Yasmin séparément (« Myrtille (Yasmin TP) »).
- **Seed gated** : on seed le référentiel 2026-2027 **uniquement** depuis la version de l'Excel
  validée par l'équipe (colonnes « ✅ Validé ? » + « Date bascule confirmée » remplies).
