# ROADMAP — Smart BERRY / GestCaisse BGF

État vivant des sprints. Voir [CLAUDE.md](CLAUDE.md) pour les conventions, [TODO_REFACTO.md](TODO_REFACTO.md) pour la dette technique.

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

- Mobile responsive complet (l'app actuelle est desktop-first).
- Tests de composants avec React Testing Library + Vitest (le build Vite le permet désormais) — voir [TODO_REFACTO.md](TODO_REFACTO.md) §5.
- TypeScript ou JSDoc strict généralisé.

---

*Dernière mise à jour : 2026-09-17 — historique des sprints caisse retiré (livrés, cf. git log) ; frontend et backend entièrement modulaires.*
