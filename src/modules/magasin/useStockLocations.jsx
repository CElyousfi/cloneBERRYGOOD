/* Pont vers le hook partagé src/modules/shared/lib/useStockLocations.js :
   fetch /api/stock?action=get-locations UNE fois, cache partagé entre les 4
   écrans magasin (MagMouvementsTab, MagReceptionTab, MagSortieTab,
   MagTransfertTab). La dérivation pure est testée dans
   tests/unit/useStockLocations.test.js. */
export { useStockLocations } from '../shared/lib/useStockLocations.js';
