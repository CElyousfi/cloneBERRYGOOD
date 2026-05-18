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

## Sprint 3 — En réflexion ⏳

Pistes (à confirmer / prioriser) :
- Modale custom pour confirmations (remplace `window.confirm()` Sprint 2)
- Tooltip custom multi-lignes pour anomalies (remplace `title=` natif Sprint 1)
- Affiner `BENEFICIAIRE_IMPRECIS` (heuristique trop laxiste sur "Avance Achat" — faux négatifs documentés Sprint 2)
- Affichage des `a_revoir_motif` côté UI (champ stocké mais non visible)
- Reporting / export PDF avancé (les rapports hebdo existent déjà mais à enrichir)
- Workflow d'approbation des imports Excel (validation manuelle avant écriture)
- Templates de bons d'achat récurrents (DA / paiements salaires)
- Mocks bypass étendus à d'autres écrans (dashboard pointage, agronomie) pour testui complet

---

## Sprint 4-5+ — Vision long terme ⏳

- **Sprint 0 différé : refonte build frontend** (Vite/esbuild + scission `app.jsx` en modules). Bloque l'extraction propre des composants en `src/modules/caisse/` etc. — voir [TODO_REFACTO.md](TODO_REFACTO.md) §1.
- Mobile responsive complet (l'app actuelle est desktop-first).
- Extraction du monolithe `functions/index.js` en modules `lib/<domain>/` à la `lib/irrigation/` — voir [TODO_REFACTO.md](TODO_REFACTO.md) §2.
- CI GitHub Actions (lint + tests unitaires + smoke headless).
- TypeScript ou JSDoc strict généralisé.

---

*Dernière mise à jour : Sprint 2 mergé sur main (`6e00e4d`) et déployé en prod le 2026-05-18.*
