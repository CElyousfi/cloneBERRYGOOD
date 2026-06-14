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
