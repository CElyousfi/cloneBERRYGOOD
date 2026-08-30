/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): PARCELLES_CULTURALES */


// ===================== RÉFÉRENTIEL PARCELLES UNIFIÉ =====================
        // Parcelles culturales par cycle — source unique de vérité
        const PARCELLES_CULTURALES = [
            // === CYCLE 1 (Sep-Déc) === F1
            { id: 'C1-S7S3-MOTTE',  cycle: 1, variete: 'Maravilla', sousVariete: 'Long Cane',  ferme: 'F1', ha: 2.6, culture: 'Framboise', nbTunnels: 72, nbPlants: 0, secteurs: ['S3','S7'],
              designations: ['S7-S3 MARAVILLA MOTTE F1', 'S3 - MARAVILLA MOTTE F1', 'S7 -MARAVILLA MOTTE F1'] },
            { id: 'C1-S1S4-MOW',    cycle: 1, variete: 'Maravilla', sousVariete: 'Mow Down',   ferme: 'F1', ha: 2.1, culture: 'Framboise', nbTunnels: 59, nbPlants: 0, secteurs: ['S1','S4'],
              designations: ['S1/S4 MARAVILLA MOW DOWN F1', 'S1/S4 Maravilla mow down F1'] },
            { id: 'C1-S2S5-MOW',    cycle: 1, variete: 'Yazmin',    sousVariete: 'Mow Down',   ferme: 'F1', ha: 2.8, culture: 'Framboise', nbTunnels: 60, nbPlants: 0, secteurs: ['S2','S5'],
              designations: ['S2-S5 YAZMIN MOW DOWN F1', 'S2 -YAZMIN MOW DOWN F1', 'S5 -YAZMIN MOW DOWN F1'] },
            // === CYCLE 1 === F5
            { id: 'C1-S10-MOTTE',   cycle: 1, variete: 'Yazmin',    sousVariete: 'Bi Cycle',   ferme: 'F5', ha: 1.9, culture: 'Framboise', nbTunnels: 43, nbPlants: 0, secteurs: ['S10'],
              designations: ['S10 YAZMIN MOTTE F5', 'S10 - YAZMIN MOTTE F5'] },
            { id: 'C1-S13-MOW',     cycle: 1, variete: 'Yazmin',    sousVariete: 'Mow Down',   ferme: 'F5', ha: 2.8, culture: 'Framboise', nbTunnels: 0, nbPlants: 0, secteurs: ['S13'],
              designations: ['S13 YAZMIN MOW DOWN F5', 'S13 - YAZMIN MOW DOWN F5'], enProduction: false },
            { id: 'C1-S9-REY',      cycle: 1, variete: 'Reyna',     sousVariete: null,          ferme: 'F5', ha: 3.0, culture: 'Framboise', nbTunnels: 66, nbPlants: 0, secteurs: ['S9'],
              designations: ['S9 REYNA F5', 'S9 - REYNA F5'], enProduction: false },
            { id: 'C1-S8-COR',      cycle: 1, variete: 'Corina',    sousVariete: null,          ferme: 'F5', ha: 2.5, culture: 'Myrtille',  nbTunnels: 64, nbPlants: 8250, secteurs: ['S8'],
              designations: ['CORINA MYRTILLE S8', 'F5 CORINA'] },

            // === CYCLE 2 (Jan-Juin) === F1
            { id: 'C2-S1S4-GC',     cycle: 2, variete: 'Maravilla', sousVariete: 'Green Cane', ferme: 'F1', ha: 4.0, culture: 'Framboise', nbTunnels: 93, nbPlants: 0, secteurs: ['S1','S3','S4','S6'],
              designations: ['MARAVILLA GG F1', 'S1.S4 Maravilla green can F1'] },
            { id: 'C2-S2357-LC',    cycle: 2, variete: 'Maravilla', sousVariete: 'Long Cane',  ferme: 'F1', ha: 5.0, culture: 'Framboise', nbTunnels: 118, nbPlants: 0, secteurs: ['S2','S3','S5','S6','S7'],
              designations: ['MARAVILLA LG F1', 'S2.S3.S5.S6.S7 maravilla logn can F1'] },
            // === CYCLE 2 === F5
            { id: 'C2-S10-CB',      cycle: 2, variete: 'Yazmin',    sousVariete: 'Bi Cycle',   ferme: 'F5', ha: 1.9, culture: 'Framboise', nbTunnels: 43, nbPlants: 0, secteurs: ['S10'],
              designations: ['S10 YAZMIN CUT BACK F5', 'S10 YAZMIN cut back F5', 'S10 YAZMIN MOTTE F5'] },
            { id: 'C2-S13-MOW',     cycle: 2, variete: 'Yazmin',    sousVariete: 'Mow Down',   ferme: 'F5', ha: 2.8, culture: 'Framboise', nbTunnels: 0, nbPlants: 0, secteurs: ['S13'],
              designations: ['S13 YAZMIN MOW DOWN F5', 'S13 - YAZMIN MOW DOWN F5'], enProduction: false },
            { id: 'C2-S9-REY',      cycle: 2, variete: 'Reyna',     sousVariete: null,          ferme: 'F5', ha: 3.0, culture: 'Framboise', nbTunnels: 66, nbPlants: 0, secteurs: ['S9'],
              designations: ['S9 REYNA F5', 'S9 - REYNA F5'], enProduction: false },
            { id: 'C2-S8-COR',      cycle: 2, variete: 'Corina',    sousVariete: null,          ferme: 'F5', ha: 2.5, culture: 'Myrtille',  nbTunnels: 64, nbPlants: 8250, secteurs: ['S8'],
              designations: ['CORINA MYRTILLE S8', 'F5 CORINA'] },
            { id: 'C2-S8-BRZ',      cycle: 2, variete: 'Breeze',    sousVariete: null,          ferme: 'F5', ha: 1.0, culture: 'Myrtille',  nbTunnels: 16, nbPlants: 3275, secteurs: ['S8-2'],
              designations: ['BREEZE MYRTILLE S8-2'] },
            { id: 'C2-S8-CAS',      cycle: 2, variete: 'Cascade',   sousVariete: null,          ferme: 'F5', ha: 1.5, culture: 'Myrtille',  nbTunnels: 34, nbPlants: 5028, secteurs: ['S8-1'],
              designations: ['CASCADE MYRTILLE S8-1'] },
            { id: 'C2-NP-BRZ',      cycle: 2, variete: 'Breeze',    sousVariete: 'Nouvelle plantation', ferme: 'F5', ha: 0.84, culture: 'Myrtille', nbTunnels: 0, nbPlants: 3425, secteurs: ['ex-S13'],
              designations: ['F5 BREEZE', 'F5- BREEZE -S13'], enProduction: false },
            { id: 'C2-NP-CAS',      cycle: 2, variete: 'Cascade',   sousVariete: 'Nouvelle plantation', ferme: 'F5', ha: 1.96, culture: 'Myrtille', nbTunnels: 0, nbPlants: 8540, secteurs: ['ex-S13'],
              designations: ['F5 CASCADE', 'F5- CASCADE -S13'], enProduction: false },

            // === AVOCATIER — ha réels issus du référentiel terrain (mis à jour ici quand nécessaire) ===
            { id: 'AVO-F2',  cycle: 1, variete: 'Avocat', sousVariete: null, ferme: 'F2',    ha: 4.86, culture: 'Avocatier', nbTunnels: 0, nbPlants: 0, secteurs: ['F2'],    designations: ['AVOCATIER F2'] },
            { id: 'AVO-F3',  cycle: 1, variete: 'Avocat', sousVariete: null, ferme: 'F3',    ha: 1.0,  culture: 'Avocatier', nbTunnels: 0, nbPlants: 0, secteurs: ['F3'],    designations: ['AVOCATIER F3'] },
            { id: 'AVO-F4',  cycle: 1, variete: 'Avocat', sousVariete: null, ferme: 'F4',    ha: 4.64, culture: 'Avocatier', nbTunnels: 0, nbPlants: 0, secteurs: ['F4'],    designations: ['AVOCATIER F4'] },
            { id: 'AVO-F6',  cycle: 1, variete: 'Avocat', sousVariete: null, ferme: 'F6',    ha: 9.13, culture: 'Avocatier', nbTunnels: 0, nbPlants: 0, secteurs: ['F6'],    designations: ['AVOCATIER F6'] },
            { id: 'AVO-BAH', cycle: 1, variete: 'Avocat', sousVariete: null, ferme: 'BAHIA', ha: 1.0,  culture: 'Avocatier', nbTunnels: 0, nbPlants: 0, secteurs: ['BAHIA'], designations: ['AVOCATIER BAHIA'] },
        ];

export { PARCELLES_CULTURALES };
