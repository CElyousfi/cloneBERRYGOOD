/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): CAMPAGNE_PARCELLE_MAP */


// ===================== CAMPAGNE TAB =====================
        // Configuration parcelle : Ha + kg exporté cumulés campagne (snapshot cpcVarietes).
        // Une ligne du tableau Campagne = une parcelle (variete + sous-type + ferme).
        // MD = Mow Down (Green Cane, mono) ; MT = Long Cane (bi cycle).
        const CAMPAGNE_PARCELLE_MAP = (() => {
            const entries = [
                { v: 'Avocat',                f: 'Avocatier', ha: 30.7, kgExport: 0,     parcelle: 'Avocat' },
                { v: 'Maravilla Mow Down',    f: 'F1',        ha: 4.2,  kgExport: 0,     parcelle: 'S1/S4 Maravilla MD' },
                { v: 'Maravilla Long Cane',   f: 'F1',        ha: 5.2,  kgExport: 19006, parcelle: 'S3/S7 Maravilla MT' },
                { v: 'Yazmin Mow Down',       f: 'F1',        ha: 2.0,  kgExport: 6602,  parcelle: 'S2/S5 Yazmin MD' },
                { v: 'Yazmin Long Cane',      f: 'F5',        ha: 1.9,  kgExport: 19748, parcelle: 'S10 Yazmin MT' },
                { v: 'Yazmin Mow Down',       f: 'F5',        ha: 2.8,  kgExport: 11666, parcelle: 'S13 Yazmin MD' },
                { v: 'Reyna',                 f: 'F5',        ha: 3.0,  kgExport: 2430,  parcelle: 'S9 Reyna' },
                { v: 'Corina',                f: 'F5',        ha: 2.5,  kgExport: 0,     parcelle: 'Corina S8' },
                { v: 'Cascade',               f: 'F1',        ha: 1.5,  kgExport: 0,     parcelle: 'Cascade S8-1' },
                { v: 'Breeze',                f: 'F1',        ha: 1.0,  kgExport: 0,     parcelle: 'Breeze S8-2' },
            ];
            const m = {};
            for (const e of entries) {
                const k = `${e.v}|${e.f}`;
                if (!m[k]) m[k] = { ha: 0, kgExport: 0, parcelles: [] };
                m[k].ha += e.ha;
                m[k].kgExport += e.kgExport;
                m[k].parcelles.push(e.parcelle);
            }
            return m;
        })();

export { CAMPAGNE_PARCELLE_MAP };
