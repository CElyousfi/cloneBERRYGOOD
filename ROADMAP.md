# ROADMAP — Smart BERRY / GestCaisse BGF

État vivant des sprints. Voir [CLAUDE.md](CLAUDE.md) pour les conventions, [TODO_REFACTO.md](TODO_REFACTO.md) pour la dette technique.

---

## Sprint 1 — Ergonomie écran Transactions ✅

**Statut** : mergé sur `main` (PR #1, commit `ed49299`).
**Périmètre** : Gestion de Caisse > Transactions.

### Livré
- Sticky footer avec 4 totaux (count, dépenses op, recettes, transferts inter-caisses, solde net)
- Recherche globale avec debounce 200 ms, raccourcis `/` (focus) et Échap (clear+blur)
- Filtres rapides en chips (Période + Type) avec désactivation automatique si datepicker modifié à la main
- Détection d'anomalies (4 règles) avec badges 🚩 + tooltip natif + fond de ligne teinté
- Extraction des helpers purs dans `public/lib/caisseUtils.js` (38 tests `node:test`)

### Sortie produit
- Front déployé sur https://berrygood-farms-dashboard.web.app

---

## Sprint 2 — Contrôle & actions groupées ✅

**Statut** : mergé sur `main` (PR #17, merge commit `6e00e4d`) et déployé en prod le 2026-05-18.
**Périmètre** : Gestion de Caisse > Transactions, et Cloud Function `caisseManagement`.

### Livré
- **Moteur d'anomalies étendu** : nouvelle fonction `detectAnomaliesBatch(transactions, now?)` qui combine les 4 règles Sprint 1 (per-tx) + 5 nouvelles règles cross-dataset :
  - `DOUBLON_PROBABLE` (Levenshtein bornée + fenêtre date ±1j + pré-groupage par caisse+montant)
  - `MONTANT_ATYPIQUE` (moyenne par analytique sur fenêtre 90j, échantillon ≥ 3)
  - `DESCRIPTION_GENERIQUE` (regex sur 5 mots vides — avance/achat/paiement/divers/frais)
  - `BENEFICIAIRE_IMPRECIS` (heuristique sur capitalisation post mot-clé — faux négatifs documentés)
  - `INCOHERENCE_CAISSE_ANALYTIQUE` (caisse Bahia ≠ analytique Bahia)
- **Vue "À contrôler"** : chip avec badge N + bouton "Accepter toutes les anomalies visibles" (batch write côté serveur). Badge ℹ️ remplace 🚩 sur les lignes acceptées.
- **Sélection multiple** : checkbox par ligne + barre sticky bordeaux quand sélection > 0 → Valider / Marquer à revoir / Réaffecter analytique (HTML5 `<dialog>`) / Exporter sélection / ×. Toast feedback.
- **Tri par colonne** : 8 colonnes triables, stable, indicateurs ↑↓⇅ (asc → desc → null).
- **Statuts enrichis** : ajout de `a_revoir`, libellés UI capitalisés/accentués (`Saisi` alias de `soumis`).
- **Migration script** `scripts/migrateStatuts.js` : `--dry-run` par défaut, `--force` pour appliquer, mock Firestore dans les tests.
- **Backend** : 4 nouvelles actions Cloud Function `caisseManagement` (`validate-transactions-batch`, `mark-revoir-batch`, `reassign-analytique-batch`, `accept-anomalies-batch`) avec chunks de 400 (Firestore limit 500).
- **Bonus dev** : `public/lib/local-test-bypass.js` — bypass auth+API local-only (`?testui=1`) pour tester l'UI sans backend, no-op en prod.

### Métriques mesurées
- `detectAnomaliesBatch` : **7-12 ms sur 5 000 tx** (cible 500 ms — 40-70× sous le budget)
- Tests : **83 / 83 verts** (70 caisseUtils + 13 migrateStatuts)
- Smoke : **16 / 16 checks** (9 Sprint 1 + 5 Sprint 2 lib + 2 sanity bundle)
- 0 régression Sprint 1

### Sortie produit
- Front + Functions déployés sur https://berrygood-farms-dashboard.web.app

---

## Sprint 3 — Rapprochement & Avances 🚧

**Statut** : en cours, branche `feature/sprint-3-rapprochement-avances`.
**Périmètre** : Gestion de Caisse — nouveaux onglets Rapprochement et Avances + helpers purs + actions Cloud Function.

### À livrer
1. **Rapprochement mensuel** (Finance/DG) : nouvelle collection `caisse_rapprochements`, 4 actions CF (`rapprochement-get/save/cloture/list`), sous-onglet **CaisseRapprochementSub** avec solde théorique calculé live, écart coloré (vert/orange/rouge), commentaire obligatoire si écart ≠ 0, bouton "Clôturer" bloqué si transactions non validées dans la période, historique des rapprochements.
2. **Suivi des avances** (tous profils en lecture, Finance/DG en régularisation) : 2 helpers purs `extractBeneficiaire` + `aggregateAvances` dans `caisseUtils.js`, 2 actions CF (`avances-liste`, `avance-regulariser`), sous-onglet **CaisseAvancesSub** avec vue agrégée par bénéficiaire (Nb avances / Total avancé / Régularisé / Solde dû / Ancienneté), couleur ligne selon ancienneté (vert <30j / jaune 30-60j / orange 60-90j / rouge >90j), checkbox "Afficher les soldées" off par défaut, modal régularisation, append-only sur `regularisations[]`.

### Décisions clé (D1-D9 validées)
- **D1** : avances sans bénéficiaire identifiable → bucket `unidentifiedCount` séparé, banner UI
- **D2** : régularisations append-only en Sprint 3, undo à voir Sprint 4+
- **D5** : collection `caisse_rapprochements` (cohérence snake_case avec `caisse_transactions`)
- **D6** : solde initial du mois calculé live, pas de stockage
- **D9** : `extractBeneficiaire` retourne UPPERCASE pour stabilité de la clé d'agrégation

### Critères d'acceptation
- `extractBeneficiaire` couvre les 16 cas tests (4 spec + 12 réel/edge) → **OK** (174/174 tests verts)
- `aggregateAvances` correct sur dataset mock 10 avances avec régularisations partielles → **OK**
- Rapprochement : clôture bloquée si transactions non validées → **OK** (validation côté serveur, blocking_transactions retournées)
- Rapprochement : commentaire obligatoire si écart ≠ 0 → **OK** (validé serveur + UI)
- 0 régression : 174 / 174 tests verts (Sprint 1 + 2 + 3)
- Smoke : 24 / 24 checks

### Limitations documentées
- `BENEFICIAIRE_IMPRECIS` heuristique laxiste (Sprint 2) reste non corrigée — Sprint 4+
- `window.confirm()` pour clôture rapprochement (modale custom = Sprint 4)
- Régularisations append-only (pas d'undo)

---

## Sprint 4 — En réflexion ⏳

Pistes (à confirmer / prioriser) :
- Modales custom (remplace `window.confirm()` Sprint 2/3)
- Tooltip custom multi-lignes pour anomalies
- Affiner `BENEFICIAIRE_IMPRECIS`
- Affichage `a_revoir_motif` côté UI
- Annulation de régularisation
- Reporting / export PDF avancé
- Workflow d'approbation imports Excel
- Templates DA / paiements salaires récurrents

---

## Sprint 4-5+ — Vision long terme ⏳

- **Sprint 0 différé : refonte build frontend** (Vite/esbuild + scission `app.jsx` en modules). Bloque l'extraction propre des composants en `src/modules/caisse/` etc. — voir [TODO_REFACTO.md](TODO_REFACTO.md) §1.
- Mobile responsive complet (l'app actuelle est desktop-first).
- Extraction du monolithe `functions/index.js` en modules `lib/<domain>/` à la `lib/irrigation/` — voir [TODO_REFACTO.md](TODO_REFACTO.md) §2.
- CI GitHub Actions (lint + tests unitaires + smoke headless).
- TypeScript ou JSDoc strict généralisé.

---

*Dernière mise à jour : Sprint 3 en cours sur `feature/sprint-3-rapprochement-avances` — PR draft à venir.*
