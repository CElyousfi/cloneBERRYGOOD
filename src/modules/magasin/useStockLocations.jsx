/* Chantier production readiness (2026-09-14) — pont ES module.
   Le hook lui-même vit dans public/lib/useStockLocations.js (chargé en
   <script defer> global AVANT le bundle modulaire, cf. public/index.html) et
   fetch /api/stock?action=get-locations UNE fois, avec un cache partagé entre
   TOUS les consommateurs (monolithe et modulaire). Les 4 écrans magasin qui
   l'utilisent (MagMouvementsTab, MagReceptionTab, MagSortieTab,
   MagTransfertTab) l'appelaient comme une variable globale implicite, jamais
   importée — ESLint no-undef le signale (statiquement une variable libre),
   mais ça fonctionnait bien à l'exécution grâce au fallthrough `window` du
   navigateur (le script global est chargé avant qu'aucun onglet ne rende).
   Corrigé quand même : import explicite comme le reste du code modulaire, et
   protection si jamais le script global n'était pas chargé (ex. futur build
   qui l'omettrait). NE duplique PAS la logique (même cache que le
   monolithe) — voir tests/unit/useStockLocations.test.js pour la dérivation
   pure testée côté public/lib/. */

const FALLBACK = { magasins: ['F1', 'F2', 'F5', 'F6'], stations: [], parcelles: {}, loading: true };

function useStockLocations() {
    if (typeof window !== 'undefined' && typeof window.useStockLocations === 'function') {
        return window.useStockLocations();
    }
    return FALLBACK;
}

export { useStockLocations };
