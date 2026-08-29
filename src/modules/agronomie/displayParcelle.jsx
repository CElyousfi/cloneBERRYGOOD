/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): displayParcelle */
import { normalizeParcelle } from './normalizeParcelle.jsx';

// Nom propre d'une parcelle SQL brute → "Maravilla Green Cane" etc.
        function displayParcelle(rawName) {
            const n = normalizeParcelle(rawName);
            if (!n) return (rawName || '').trim();
            return n.sousVariete ? `${n.variete} ${n.sousVariete}` : n.variete;
        }

export { displayParcelle };
