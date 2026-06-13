# Ticket — Module « Mapping parcelles de consommation »

## Contexte
Le magasinier saisit les sorties de stock contre une liste de parcelles fines (secteur + stade de taille). Le référentiel récolte BEE ONE raisonne en blocs opérationnels. Les deux univers n'ont **pas la même population** : des parcelles en établissement consomment sans produire, donc absentes de BEE ONE. Il faut une couche de réconciliation versionnée par campagne, **sans bloquer la saisie stock ni dupliquer le référentiel analytique**.

## Objectif
1. Matérialiser l'univers magasinier comme parcelles de consommation (côté charge).
2. Gérer le mapping vers la parcelle culturale, **versionné par campagne**.
3. Résoudre les charges stock vers le CPC au bon niveau analytique.
4. Exposer l'écran de suivi livré (`MappingParcellesConsommation.jsx`).

## Modèle de données (Firestore)

### Collection `parcelles_consommation` — référentiel magasinier, STABLE
Champs : `id`, `libelle`, `ferme`, `secteur`, `variete`, `stade`, `famille` (→ un des 16 codes famille analytique).
**Ancrage** : doit s'aligner sur la dimension déjà utilisée par le module Stock pour les pointages. Ne pas créer de doublon — réconcilier avec l'existant.

### Collection `mapping_campagne` — le lien, VERSIONNÉ
- doc id = `${campagne}__${parcelle_conso_id}`
- Champs : `campagne`, `parcelle_conso_id`, `cible_parcelle_culturale` (FK → référentiel niveau 2, nullable), `statut`, `confiance`, `note`, `valide_par`, `valide_le`.
- Statuts : `matched | alias_propose | alias_valide | a_creer | creee | hors_propose | hors_confirme`.

`pointages` **n'est pas stocké** : agrégat (count par parcelle_conso × campagne) depuis les mouvements de stock.

## Composant front
- Intégrer `MappingParcellesConsommation.jsx` (fourni).
- Adapter au runtime CDN/Babel : retirer `import` / `export default`, utiliser `const { useState, useMemo } = React;` et la convention de composant/route existante du repo.
- Remplacer le `SEED` par un `onSnapshot` filtré par campagne ; brancher la fonction `patch()` sur `updateDoc(mapping_campagne, …)`.
- Route sous la section Stock / Référentiel.

## Resolver (à la consolidation CPC)
Pour chaque sortie de stock : `parcelle_consommation → mapping_campagne[campagne] → parcelle_culturale → famille analytique → ligne CPC`.
- Exclure de la résolution tout statut **non tranché** : `alias_propose`, `a_creer`, `hors_propose`.
- `hors_confirme` : exclu du CPC mais marqué résolu.
- Implémentation au choix : Cloud Function (clôture / continu) ou client à la génération du CPC.

## Règles métier
- La saisie stock reste **totalement découplée** : elle s'attache à `parcelle_consommation`, jamais au mapping.
- L'action « Créer la parcelle » (`a_creer → creee`) doit écrire une nouvelle `parcelle_culturale` côté charge **avant** de basculer le statut.
- `valide_par` / `valide_le` branchés sur l'auth pour la traçabilité des validations.

## Données de seed (campagne 2025-2026)
8 matched, 6 alias proposés, 4 à créer, 1 hors-périmètre (BAHIA, source à confirmer) + 4 regroupements avocatier par ferme (F2/F3/F4/F6). Détail exhaustif dans le `SEED` du composant livré.

## Critères d'acceptation / QA
- [ ] L'écran charge le mapping de la campagne sélectionnée depuis Firestore et recalcule le taux de couverture en direct.
- [ ] Les actions (valider, créer, confirmer, réaffecter) persistent dans `mapping_campagne`.
- [ ] **Conservation** : somme des charges résolues vers le CPC = somme des sorties de stock de la campagne, déduction faite du hors-périmètre. *Test unitaire dédié.*
- [ ] Aucune charge en statut non tranché n'atteint le CPC.
- [ ] Empty-state correct pour une campagne sans mapping.

## Hors-périmètre (backlog ultérieur)
- Vue « comparer campagnes » (visualisation de la dérive du mapping).
- Ventilation avocatier par variété (décision actuelle : par ferme).

## Dépendances
Référentiel analytique niveau 2 (parcelle culturale) · 16 codes famille analytique · module Stock (mouvements / pointages).

## Workflow de livraison
Worktree dédié → Developer → QA (conservation) → merge `main` → `scripts/deploy.sh` (remote `BERRYGOOD`, `FIREBASE_TOKEN`).
