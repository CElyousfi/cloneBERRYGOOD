# Référentiel analytique unifié — v1 (proposition, GATED)

> Colonne vertébrale partagée par TOUS les modules (CPC, Achats/Dépenses, Pointage,
> Coût Récolte, Agronomie). Construit UNE fois. **Aucune collection créée avant
> validation Omar + convergence avec son Excel.**

## 1. Les 4 niveaux

| Niveau | Dimension | Source actuelle | État |
|--------|-----------|-----------------|------|
| 1 | **Campagne** (1er juil → 30 juin, label `2025/2026`) | calculé par date (pointageService.js:2222) | existe, pas de champ `id_campagne` |
| 2 | **Parcelle culturale** décomposée → 2a culture / 2b variété / 2c cycle / 2d système | `PARCELLES_CULTURALES` (parcellesCulturales.js, app.jsx:2484) | existe mais **mélangé** |
| 3 | **Ferme** (F1–F6, BAHIA, Avocatier) | constante + `deriveFerme()` | existe |
| 4 | **Famille analytique** (16 codes) | seulement ENG+PES (Article_Categorie) | **14/16 à créer** |

## 2. ⚠️ Problème central résolu : décomposition variété/système/cycle

Aujourd'hui le champ `sousVariete` **mélange 3 concepts** :
- cultivar (Corina, Breeze, Cascade),
- **système** de culture (Green Cane, Long Cane, Mow Down),
- **statut** (Nouvelle plantation),
et le **cycle** est un champ séparé (`cycle` 1/2 = semestre). Résultat : labels type « Maravilla GC » / « Maravilla Mow Down » / « Maravilla Long Cane » impossibles à croiser proprement.

**Cible — 4 attributs DISTINCTS** par parcelle :
- `culture` : Framboise | Myrtille | Avocatier
- `variete` (cultivar pur) : Maravilla | Yasmin | Reyna | Adelita | Corina | Cascade | Breeze | Hass…
- `cycle` : Monocycle (défaut) | Bicycle (framboise uniquement)
- `systeme` : Long Cane | Green Cane | Mow Down | Hors-sol | Plein champ

## 3. Inventaire complet des parcelles (état actuel décomposé)

18 parcelles. ⚠️ `cycle` ci-dessous = champ actuel (1=Sep-Déc, 2=Jan-Juin) — **À NE PAS confondre** avec le cycle cible (Mono/Bi). Le mapping cible est en colonne « cycle cible » / « système cible ».

### Framboise / Myrtille (13)
| id | ferme | culture | variété | sousVariété actuelle | → système cible | → cycle cible | ha | désignation BEE ONE |
|----|-------|---------|---------|----------------------|------------------|----------------|----|----|
| C1-S7S3-MOTTE | F1 | Framboise | Maravilla | Long Cane | Long Cane | Bicycle | 2.6 | S7-S3 MARAVILLA MOTTE F1 |
| C1-S1S4-MOW | F1 | Framboise | Maravilla | Mow Down | Mow Down | Monocycle | 2.1 | S1/S4 MARAVILLA MOW DOWN F1 |
| C1-S2S5-MOW | F1 | Framboise | Yasmin | Mow Down | Mow Down | Monocycle | 2.8 | S2-S5 YAZMIN MOW DOWN F1 |
| C2-S1S4-GC | F1 | Framboise | Maravilla | Green Cane | Green Cane | Monocycle | 4.0 | MARAVILLA GG F1 |
| C2-S2357-LC | F1 | Framboise | Maravilla | Long Cane | Long Cane | Bicycle | 5.0 | MARAVILLA LG F1 |
| C1-S10-MOTTE | F5 | Framboise | Yasmin | Bi Cycle | Long Cane | Bicycle | 1.9 | S10 YAZMIN MOTTE F5 |
| C2-S10-CB | F5 | Framboise | Yasmin | Bi Cycle | Long Cane | Bicycle | 1.9 | S10 YAZMIN CUT BACK F5 |
| C1/C2-S13-MOW | F5 | Framboise | Yasmin | Mow Down | Mow Down | Monocycle | 2.8 | S13 YAZMIN MOW DOWN F5 |
| C1/C2-S9-REY | F5 | Framboise | Reyna | null | (à préciser) | (à préciser) | 3.0 | S9 REYNA F5 |
| C1/C2-S8-COR | F5 | Myrtille | Corina | null | Plein champ? | Monocycle | 2.5 | CORINA MYRTILLE S8 |
| C2-S8-BRZ | F5 | Myrtille | Breeze | null | Plein champ? | Monocycle | 1.0 | BREEZE MYRTILLE S8-2 |
| C2-S8-CAS | F5 | Myrtille | Cascade | null | Plein champ? | Monocycle | 1.5 | CASCADE MYRTILLE S8-1 |
| C2-NP-BRZ/CAS | F5 | Myrtille | Breeze/Cascade | Nouvelle plantation | (statut, pas système) | — | 0.84/1.96 | F5 BREEZE / F5 CASCADE |

### Avocatier (5, culture pérenne)
| id | ferme | culture | variété | ha |
|----|-------|---------|---------|----|
| AVO-F2/F3/F4/F6/BAH | F2,F3,F4,F6,BAHIA | Avocatier | Avocat (→ préciser Hass ?) | 0 |

→ **Question Omar (Excel)** : système/cycle cible pour Reyna, myrtilles (Plein champ ?), variété Avocat (Hass ?). Le statut « Nouvelle plantation » devient un attribut séparé `statut` (production | nouvelle_plantation | fin_de_vie), PAS un système.

## 4. Familles analytiques (niveau 4 — 16 codes à créer)

| Code | Libellé | Existe ? |
|------|---------|----------|
| ENG | Engrais | ✅ (Article_Categorie='Engrais') |
| PES | Pesticides | ✅ (Article_Categorie='Pesticides') |
| PLA, LOY, EAU, ELE, COM, FTA, ENC, QNZ, CIR, IRB, ENT, EQP, LOG, AFG | (cf. brief) | ❌ à créer |

Les charges hors ENG/PES (eau ORMVA, électricité, salaires/quinzaines, CNSS&IR, irrigation, entretien, équipements, logistique, admin) **n'existent pas** en données structurées aujourd'hui → la famille analytique sera portée par le **module Dépenses** (chaque facture/règlement porte `familleAnalytique`).

## 5. Mapping Smart Berry ↔ BEE ONE

| Attribut cible | Smart Berry | BEE ONE (SQL) |
|----------------|-------------|----------------|
| culture | `PARCELLES_CULTURALES.culture` | `Culture` (BR_Pointage/BR_Consommation/BR_Cueillette) |
| variété | `.variete` | `Variete` (parfois générique « Myrtille ») |
| système | `.sousVariete` (à décomposer) | absent (déduit du nom parcelle) |
| cycle | `.cycle` (semestre, à reconcevoir) | absent (déduit par date) |
| ferme | `.ferme` / `deriveFerme()` | `Ref_parcelle` + règles |
| parcelle | `.designations[]` + `normalizeParcelle()` | `Parcelle_Culturale` (libellés bruts incohérents) |
| famille | — | `Article_Categorie` (2 valeurs seulement) |

## 6. Incohérences trouvées + résolution proposée

1. **sousVariete fourre-tout** → séparer en `variete` (cultivar) + `systeme` + `statut`. (cf. §2)
2. **cycle = semestre** vs cycle cible Mono/Bi → renommer l'actuel en `semestre` et créer `cycle` (Mono/Bi). 
3. **Libellés BEE ONE bruts incohérents** (espacements/ordre secteurs) → garder `normalizeParcelle()` + `DESIGNATION_MAP` comme couche de normalisation ; le référentiel devient la source canonique (chaque parcelle a un `id` stable + ses `designations[]` BEE ONE).
4. **Variété générique vs spécifique** (Myrtille → Corina/Breeze/Cascade) → `resolveMyrtilleVariete()` existant, à intégrer au référentiel.
5. **Pas de `id_campagne`** → calculer la campagne par date (helper unique partagé) ; pas de migration.

## 7. Schéma Firestore proposé (À VALIDER, non créé)

```
referentiel_parcelles/{parcelleId}          // 18 docs
  { id, ferme, culture, variete, systeme, cycle, statut,
    ha, nbTunnels, nbPlants, secteurs[], designations[], enProduction }
referentiel_familles_analytiques/{code}      // 16 docs
  { code, libelle, type, ordre, actif }
app_settings/referentiel_meta                // campagnes, fermes, listes de valeurs
  { campagnes[], fermes[], cultures[], varietes[], systemes[] }
```
- Lecture client (auth), écriture CF only (admin) — comme les autres référentiels.
- Index : peu nécessaires (petites collections lues en bloc + cachées).
- Helper pur partagé `public/lib/referentielUtils.js` (UMD, IIFE — anti-collision globale) + `<AnalytiqueSelector>` réutilisable.

## 8. Convergence avec l'Excel d'Omar
Cet audit = état du CODE. L'Excel d'Omar apporte : système/cycle cible par parcelle, variété Avocat (Hass ?), mapping BEE ONE validé, et la liste exhaustive des parcelles réelles (si > 18). **Les deux doivent être réconciliés avant toute création Firestore.**

## Points GATED à trancher (Omar)
1. Système/cycle cible pour Reyna, myrtilles, avocat (via Excel).
2. Renommer `cycle` actuel → `semestre` + nouveau `cycle` Mono/Bi : OK ?
3. Schéma Firestore §7 validé ?
4. Les 14 familles manquantes : portées par le module Dépenses (pas de source SQL) — confirmer.
