/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): BDC_SOCIETE_DEFAULT */


// Sociétés émettrices des Bons de Commande, indexées par ferme.
        // BAHIA est une entité juridique distincte de BERRY GOOD FARMS — son entête PDF est spécifique.
        // Toute ferme non listée → BDC_SOCIETE_DEFAULT (BERRY GOOD FARMS).
        // TODO: compléter les infos légales BAHIA (raison sociale exacte, capital, adresse, RC, ICE).
        const BDC_SOCIETE_DEFAULT = {
            nom: 'BERRY GOOD FARMS',
            forme: 'SARL au Capital de 100.000 DH',
            adresse: 'RES AL BOUSTANE 44 IMMEUBLE A — 80000 AGADIR',
            immat: 'RC 38125 — ICE 002106859000069',
            footer: 'Berry Good Farms SARL',
        };

export { BDC_SOCIETE_DEFAULT };
