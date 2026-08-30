/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): normalizeParcelle */
import { DESIGNATION_MAP } from './DESIGNATION_MAP.jsx';

// Normalise toute designation vers { variete, sousVariete, ferme, culture }
        function normalizeParcelle(rawName) {
            if (!rawName) return null;
            const trimmed = rawName.trim();
            if (DESIGNATION_MAP[trimmed]) return DESIGNATION_MAP[trimmed];
            if (DESIGNATION_MAP[trimmed.toUpperCase()]) return DESIGNATION_MAP[trimmed.toUpperCase()];
            // Fuzzy mots-clés
            const u = trimmed.toUpperCase();
            const fermeHint = u.includes('F1') ? 'F1' : u.includes('F5') ? 'F5' : null;
            if (u.includes('MARAVILLA')) {
                if (u.includes('GG') || u.includes('GREEN') || /\bGC\b/.test(u)) return { variete:'Maravilla', sousVariete:'Green Cane', ferme: fermeHint||'F1', culture:'Framboise' };
                if (u.includes('MOTTE') || u.includes('LONG') || /\bLG\b/.test(u)) return { variete:'Maravilla', sousVariete:'Long Cane', ferme: fermeHint||'F1', culture:'Framboise' };
                if (u.includes('MOW')) return { variete:'Maravilla', sousVariete:'Mow Down', ferme: fermeHint||'F1', culture:'Framboise' };
                return { variete:'Maravilla', sousVariete:null, ferme: fermeHint||'F1', culture:'Framboise' };
            }
            if (u.includes('YAZMIN') || u.includes('YASMIN')) {
                if (u.includes('MOTTE') || u.includes('BI')) return { variete:'Yazmin', sousVariete:'Bi Cycle', ferme: fermeHint||'F5', culture:'Framboise' };
                if (u.includes('MOW')) return { variete:'Yazmin', sousVariete:'Mow Down', ferme: fermeHint||'F5', culture:'Framboise' };
                if (u.includes('CUT')) return { variete:'Yazmin', sousVariete:'Bi Cycle', ferme: fermeHint||'F5', culture:'Framboise' };
                return { variete:'Yazmin', sousVariete:null, ferme: fermeHint||'F5', culture:'Framboise' };
            }
            if (u.includes('REYNA') || u.includes('REINA')) return { variete:'Reyna', sousVariete:null, ferme:'F5', culture:'Framboise' };
            if (u.includes('CORINA') || u.includes('CORRINA')) return { variete:'Corina', sousVariete:null, ferme:'F5', culture:'Myrtille' };
            if (u.includes('CASCADE')) return { variete:'Cascade', sousVariete:null, ferme:'F5', culture:'Myrtille' };
            if (u.includes('BREEZE')) return { variete:'Breeze', sousVariete:null, ferme:'F5', culture:'Myrtille' };
            if (u.includes('ADELITA')) return { variete:'Adelita', sousVariete:null, ferme:'F5', culture:'Framboise' };
            return null;
        }

export { normalizeParcelle };
