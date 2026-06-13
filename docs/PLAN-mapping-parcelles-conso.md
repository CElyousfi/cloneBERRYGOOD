# Plan d'implémentation — Module Mapping parcelles de consommation

> Source de vérité : `docs/TICKET-mapping-parcelles-consommation.md`. Composant fourni : `MappingParcellesConsommation.jsx` (déposé, runtime React standard à adapter au CDN/Babel).

## Décisions d'architecture (architecte)

### Ancrage (le point dur du ticket)
- Les sorties/consommations de stock s'attachent déjà à une parcelle via
  `stock_movements.lieu_destination = { type:'parcelle', id:<libellé> }`
  (Bons Consommation, app.jsx ~48050 ; import canevas `buildLieu`).
- **`parcelles_consommation` = la liste canonique de ces `id` (libellés magasinier).**
  AUCUN doublon de `PARCELLES_CULTURALES` (qui reste le référentiel niveau-2 culturale BEE ONE).
- La saisie stock continue d'écrire `lieu_destination.id = parcelle_consommation.libelle`.
  Le mapping ne la touche jamais (contrainte « saisie 100 % découplée »).
- `cible_parcelle_culturale` (FK niveau-2) = **nom brut de la Parcelle_Culturale BEE ONE**
  (ex. `"S2.S3.S5.S6.S7 Maravilla long can F1"`), pas un renommage. C'est ce mapping
  explicite/validé qui remplace le renommage caché refusé par Omar.

### Statuts & couverture
- COVERED (résolu, atteint le CPC) : `matched`, `alias_valide`, `creee`.
- NON TRANCHÉ (exclu du CPC) : `alias_propose`, `a_creer`, `hors_propose`.
- `hors_confirme` : RÉSOLU mais EXCLU du CPC (hors-périmètre confirmé).

## Tâches Developer

### T1 — Modèle de données + seed (gated: write prod = validation finale Omar)
- `functions/lib/mappingConso/seed.js` : constante `SEED_2025_2026` = les 19 lignes du
  composant (8 matched, 6 alias_propose, 4 a_creer, 1 hors_propose) + 4 entrées avocatier
  par ferme (info card, pas de mapping). Champs `parcelles_consommation` :
  `{ id, libelle, ferme, secteur, variete, stade, famille }`. Dériver ferme/secteur/variete/stade
  du libellé quand possible (pas bloquant si partiel).
- `mapping_campagne` doc id = `${campagne}__${parcelle_conso_id}`,
  champs `{ campagne, parcelle_conso_id, cible_parcelle_culturale, statut, confiance, note,
  valide_par, valide_le }`. `pointages` N'EST PAS stocké.
- Script de seed idempotent `functions/scripts/seedMappingConso.js` (merge:true, --dry-run par
  défaut). NE PAS exécuter contre prod sans GO Omar.
- `famille` → un des 16 codes famille analytique : localiser la liste réelle (index.js ~8096
  `code_analytique`/`nature_cpc`) et mapper Avocatier/Framboise/Myrtille au bon code ; si pas de
  correspondance 1:1, garder le libellé culture + TODO documenté (ne pas inventer un code).

### T2 — Resolver pur + test de conservation (LE GATE QA)
- `functions/lib/mappingConso/resolver.js` (pur, `'use strict'`, `// @ts-check`, DI) :
  `resolveCharges({ mouvements, mapping, campagne })` → pour chaque sortie de stock de la campagne :
  `parcelle_consommation → mapping_campagne[campagne] → cible_parcelle_culturale → famille → ligne CPC`.
  - Exclure les statuts non tranchés (`alias_propose|a_creer|hors_propose`) → bucket `non_resolu`.
  - `hors_confirme` → bucket `hors_perimetre` (résolu, hors CPC).
  - Retour : `{ cpc:[{cpc_code/famille, montant}], horsPerimetre, nonResolu, totalSorties }`.
- `pointages` = agrégat (count par parcelle_conso × campagne) depuis `stock_movements`
  (helper `aggregatePointages(mouvements, campagne)`). Trouver la fn campagne existante
  (frontière Sat-Fri / getCampagne) sinon helper local documenté.
- **Test `functions/lib/mappingConso/__tests__/resolver.test.js` (node:test)** :
  CONSERVATION → `Σ(cpc.montant) + Σ(horsPerimetre) + Σ(nonResolu) === Σ(totalSorties)`
  ET `Σ charges atteignant le CPC === Σ sorties − horsPerimetre − nonResolu`.
  Vérifier qu'AUCUNE charge non tranchée n'atteint le CPC. Fixtures couvrant les 7 statuts.

### T3 — Front : adapter le composant au runtime CDN/Babel
- Copier `MappingParcellesConsommation.jsx` → `public/components/MagMappingConsoTab.jsx`.
- Retirer `import {…} from "react"` et `export default` ; pattern IIFE `window.MagMappingConsoTab`
  (cf. modularisation Phase 1, build-frontend.js babelise public/components/*.jsx).
  `const { useState, useMemo } = React;`.
- Remplacer le `SEED` interne par `onSnapshot(query(collection('mapping_campagne'),
  where('campagne','==',campagne)))` joint à `parcelles_consommation` (libelle, famille, pointages).
- `patch()` → `updateDoc(doc('mapping_campagne', id), { ...changes, valide_par, valide_le:serverTimestamp() })`.
  `valide_par` depuis l'auth (`authUser.uid` / profileData).
- « Créer la parcelle » (`a_creer → creee`) : écrire d'ABORD une `parcelle_culturale` côté charge
  (collection/constante cible niveau-2) PUIS basculer le statut. Si l'écriture du référentiel
  niveau-2 n'est pas une collection mais une constante, prévoir une collection
  `parcelles_culturales_charge` net-new (documenter) — NE PAS muter PARCELLES_CULTURALES hardcodé.
- `pointages` affiché = lecture de l'agrégat (endpoint ou compute client léger).

### T4 — Route sous Stock/Référentiel
- `NAV_ITEMS_MAGASINIER` (app.jsx ~465) : `{ id:'mag_mapping_conso', label:'Mapping Parcelles Conso', icon:'fa-link' }`.
- `renderTab('mag_mapping_conso', MagMappingConsoTab, { currentProfile, profileData, authUser }, 'Mapping Parcelles Conso')` (~63961).
- Build : `npm run build:frontend` vert (sentinelles + cache-bust).

## Garde-fous
- Saisie stock JAMAIS modifiée. Mapping = couche de lecture/réconciliation uniquement.
- Seed/écriture prod Firestore + deploy = **GATED** → STOP, GO Omar (validation finale).
- Gate bloquant QA = test de conservation vert.
