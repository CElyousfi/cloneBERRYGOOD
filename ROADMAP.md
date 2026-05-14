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

## Sprint 2 — Contrôle & actions groupées 🚧

**Statut** : en cours, branche `feature/sprint-2-controle`.
**Périmètre** : Gestion de Caisse > Transactions, et Cloud Function `caisseManagement`.

### À livrer
1. **Moteur d'anomalies étendu** — 5 nouvelles règles cross-dataset :
   - `DOUBLON_PROBABLE` (Levenshtein + fenêtre date)
   - `MONTANT_ATYPIQUE` (moyenne par analytique sur 90j)
   - `DESCRIPTION_GENERIQUE` (regex sur mots vides)
   - `BENEFICIAIRE_IMPRECIS` (heuristique sur capitalisation post mot-clé)
   - `INCOHERENCE_CAISSE_ANALYTIQUE` (caisse Bahia ≠ analytique Bahia)
   - Nouvelle fonction `detectAnomaliesBatch(transactions, now?)` qui combine Sprint 1 (per-tx) + Sprint 2 (cross-dataset)
2. **Vue "À contrôler"** — chip de filtre avec badge N, action "Accepter toutes les anomalies visibles" (batch write côté serveur)
3. **Sélection multiple** — checkbox par ligne + barre sticky d'actions groupées (valider, marquer à revoir, réaffecter analytique, exporter sélection)
4. **Tri par colonne** — Date, Caisse, Type, Réf., Description, Analytique, Montant, Statut. Tri stable, indicateurs visuels ↑↓⇅.
5. **Statuts enrichis** — ajout de `a_revoir`, libellés UI capitalisés/accentués. Script de migration Firestore avec `--dry-run` par défaut.

### Côté backend (nouvelles actions Cloud Function `caisseManagement`)
- `validate-transactions-batch`
- `mark-revoir-batch`
- `reassign-analytique-batch`
- `accept-anomalies-batch`

### Critères d'acceptation
- `detectAnomaliesBatch` < 500 ms sur 5 000 tx (test perf)
- Batch validation 100 tx = 1 seul writeBatch (ou 2 chunks si > 500 côté serveur)
- Tri instantané < 50 ms sur 5 000 lignes
- N de "À contrôler" se met à jour sans reload
- `migrateStatuts --dry-run` n'écrit jamais (mock Firestore dans le test)
- 0 régression Sprint 1 (`npm run test:unit` reste vert)

---

## Sprint 3 — En réflexion ⏳

Pistes (à confirmer en fin de Sprint 2) :
- Modale custom pour confirmations (remplace `window.confirm()` Sprint 2)
- Tooltip custom multi-lignes pour anomalies (remplace `title=` natif Sprint 1)
- Reporting / export PDF avancé (les rapports hebdo existent déjà mais à enrichir)
- Workflow d'approbation des imports Excel (validation manuelle avant écriture)
- Templates de bons d'achat récurrents (DA / paiements salaires)

---

## Sprint 4-5+ — Vision long terme ⏳

- **Sprint 0 différé : refonte build frontend** (Vite/esbuild + scission `app.jsx` en modules). Bloque l'extraction propre des composants en `src/modules/caisse/` etc. — voir [TODO_REFACTO.md](TODO_REFACTO.md) §1.
- Mobile responsive complet (l'app actuelle est desktop-first).
- Extraction du monolithe `functions/index.js` en modules `lib/<domain>/` à la `lib/irrigation/` — voir [TODO_REFACTO.md](TODO_REFACTO.md) §2.
- CI GitHub Actions (lint + tests unitaires + smoke headless).
- TypeScript ou JSDoc strict généralisé.

---

*Dernière mise à jour : Sprint 2 démarré, CLAUDE.md/ROADMAP.md créés.*
