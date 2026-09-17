# Spec — Champ `campagne` sur le référentiel parcelles (GATED)

> Statut : **spec, non implémenté**. Demande d'Omar le 2026-08-19, à la suite du
> bug « parcelles des bons de consommation non filtrées par le référentiel RH ».
> Attend un « GO spec-referentiel-campagne-parcelle » explicite.

## 1. Problème

Aujourd'hui, l'appartenance d'une parcelle à une campagne n'est **jamais
déclarée** : elle est **déduite des dates de pointage** BEE ONE, dans
`functions/src/modules/rh/pointageService.js` (action `parcelles-campagne-list`) :

- campagne courante = parcelles avec au moins un `BR_Pointage.Periode_Date >= 2026-07-01` ;
- campagne précédente = pointage entre 2025-07-01 et 2026-06-30, hors labels déjà
  en courante.

Conséquences observées :

1. **Le périmètre dépend d'un flux externe.** Une parcelle arrachée mais pointée
   une fois en juillet reste « active ». Une parcelle réelle sans pointage
   n'apparaît nulle part (ni saisie stock, ni budget).
2. **Le cut-off `2026-07-01` est codé en dur** dans le backend : chaque nouvelle
   campagne demande une modification de code.
3. **Chaque onglet refait sa propre déduction** (Bons de consommation, Campagne
   Budget, Parcelles & Référentiel) → divergences d'affichage comme celle
   corrigée par `sb/bc-parcelles-referentiel`.
4. Le référentiel RH (`sb_parcelle_referentiel`) ne porte aujourd'hui que
   `label_bee_one`, `nom_sb`, `ha`, `culture_sb` — **aucune notion de campagne**,
   donc aucun moyen pour le RH de sortir une parcelle du périmètre.

## 2. Cible

Ajouter un champ **`campagnes`** au document `sb_parcelle_referentiel/<LABEL>` :

```jsonc
{
  "label_bee_one": "S10 YAZMIN CUT BACK F5",
  "nom_sb": "F5 - MYRTILLE EXTENSION",
  "ha": 1.9,
  "culture_sb": "Myrtille",
  "campagnes": ["2026-2027"],   // NOUVEAU — liste explicite, format campagneUtils
  "actif": true                  // NOUVEAU — sortie de périmètre sans suppression
}
```

Choix retenus (et pourquoi) :

- **Tableau `campagnes[]`, pas un scalaire `campagne`** : une parcelle pérenne
  (avocatier) traverse plusieurs campagnes ; un scalaire obligerait à dupliquer
  le document ou à le réécrire chaque 1er juillet.
- **Format `'2026-2027'`** : exactement celui de `public/lib/campagneUtils.js`
  (`campagneOf()`), déjà utilisé par MagBCTab (`bcCampagne`). Pas de nouveau format.
- **`actif` séparé** : « ne fait plus partie du périmètre » ≠ « n'a jamais existé ».
  Les bons historiques doivent continuer à résoudre leur nom SB.
- **Le libellé BEE ONE reste la clé** : aucun renommage de champ, aucune migration
  des données stock/analytique (cf. CLAUDE.md — ne jamais renommer un champ consommé).

## 3. Plan d'implémentation

### 3.1 Backend — `functions/src/modules/rh/pointageService.js`

1. `sb-referentiel-save` : accepter `campagnes` (array de strings `^\d{4}-\d{4}$`,
   max 10) et `actif` (bool, défaut `true`). Rejeter tout autre format en 400.
   Rôles inchangés (`dg | rh | admin`).
2. `parcelles-campagne-list` : conserver la déduction BEE ONE **comme fallback**,
   mais la faire passer par un merge avec le référentiel :
   - parcelle avec `campagnes` déclaré → classée **uniquement** d'après ce champ ;
   - parcelle sans `campagnes` → comportement actuel (dates de pointage) ;
   - parcelle avec `actif: false` → exclue des deux listes, mais toujours servie
     par `sb-referentiel-list` (résolution des noms historiques).
   Ajouter au retour, par ligne : `campagne_source: 'referentiel' | 'pointage'` —
   permet à l'écran RH d'afficher ce qui est déclaré vs déduit.
3. Nouvelle action `sb-referentiel-seed-campagne` (POST, DG/RH) : initialise
   `campagnes` de toutes les entrées existantes à partir de la déduction actuelle
   (idempotent, `merge: true`, ne touche pas une entrée qui a déjà `campagnes`).
   **C'est le seul write de masse — il est GATED** (cf. §5).

### 3.2 Front

1. `public/components/ParcellesReferentielTab.jsx` : dans `PRT_EditRow`, ajouter
   un multi-select Campagnes (courante / précédente / suivante) + une case
   « Parcelle active ». Badge « déduit » quand `campagne_source === 'pointage'`.
2. `public/components/MagBCTab.jsx` : aucune modification supplémentaire —
   `refForCampagne` consomme déjà `campagne_courante` / `campagne_precedente`.
   Le fix `sb/bc-parcelles-referentiel` (nom_sb / culture_sb) reste nécessaire et
   indépendant : il traite l'**affichage**, ce spec traite le **périmètre**.
3. `public/components/CampagneBudgetTab.jsx` : vérifier que le périmètre budget
   suit la même liste (il consomme déjà `parcelles-campagne-list`).

### 3.3 Tests

- `tests/unit/` : helper pur de classification
  `classerParcelleCampagne({ campagnes, actif }, deductionPointage)` — 6 cas :
  déclaré seul, déduit seul, déclaré + déduit divergents (déclaré gagne),
  `actif: false`, `campagnes: []` (= aucune campagne, exclue), format invalide.
- Test de non-régression : une parcelle sans entrée référentiel garde exactement
  le classement actuel.

## 4. Validation croisée (données prod au 2026-08-19)

`sb_parcelle_referentiel` contient **15 documents**, `parcelles-campagne-list`
renvoie **17 lignes** en 2026/2027. Les 2 sans entrée référentiel : `F2 - ZUTANO`,
`F4 -FUERTE`. Après seed, les 15 auront `campagnes: ['2026-2027']` et les 2
autres resteront en mode déduit — l'écran RH doit afficher exactement les mêmes
17 lignes qu'aujourd'hui. **Toute différence = bug de seed.**

Cas concret ayant motivé la demande : `S10 YAZMIN CUT BACK F5` (nom SB
« F5 - MYRTILLE EXTENSION », 1.9 Ha, Myrtille) — présente dans le référentiel,
donc conservée ; c'est bien son **nom** qui était faux, pas son appartenance.

## 5. Risques / points GATED

| Point | Statut |
|---|---|
| `sb-referentiel-seed-campagne` (write de masse Firestore) | **GATED** — GO Omar requis, dry-run d'abord |
| Passage du périmètre « déduit » → « déclaré » | **GATED** — change le comportement produit de 3 onglets |
| Ajout des champs `campagnes` / `actif` (schéma additif) | Autonome — aucun champ existant touché |
| Suppression du cut-off codé en dur `2026-07-01` | À faire APRÈS le seed, sinon les parcelles sans déclaration disparaissent |

Edge cases à traiter explicitement à l'implémentation :

- Référentiel non chargé (fetch KO) → **ne jamais filtrer à vide** : retomber sur
  la déduction pointage. Une liste vide bloquerait la saisie des bons.
- Parcelle déclarée sur une campagne mais avec du pointage sur une autre :
  les deux listes doivent la montrer là où elle est **déclarée**, et l'écran RH
  signaler l'écart (bandeau, pas de correction automatique).
- Bons de consommation historiques pointant sur une parcelle `actif: false` :
  affichage inchangé (nom SB résolu), mais parcelle absente du sélecteur.

## 6. Fini quand

Le RH peut cocher les campagnes d'une parcelle dans « Parcelles & Référentiel »,
et cette déclaration pilote à l'identique le périmètre des onglets Bons de
consommation, Campagne Budget et Parcelles & Référentiel — sans cut-off de date
codé en dur.
