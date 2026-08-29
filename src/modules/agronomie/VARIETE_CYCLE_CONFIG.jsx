/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): VARIETE_CYCLE_CONFIG */


// Configuration cycle par variété (framboises principalement).
        // 'bi'   : variété bi-cycle (primocane + floricane) → affichée dans Cycle 1 et Cycle 2
        // 'mono' : variété mono-cycle (un seul cycle de production) → affichée uniquement dans le cumul annuel
        // Variétés non listées : default = 'bi'
        const VARIETE_CYCLE_CONFIG = {
            // Framboises — sous-types détectés par mots-clés dans le nom de parcelle (MD/MOTTE/Green Cane vs MT/Long Cane)
            'Reyna':                'mono',
            'Maravilla Mow Down':   'mono',  // = Green Cane
            'Maravilla Long Cane':  'bi',
            'Maravilla':            'bi',    // fallback si sous-type non détecté
            'Yazmin Mow Down':      'mono',
            'Yazmin Long Cane':     'bi',    // = Yazmin Bi Cycle
            'Yazmin':               'bi',    // fallback
            'Adelita':              'bi',
            // Myrtilles — toujours mono-cycle
            'Corina':               'mono',
            'Cascade':               'mono',
            'Breeze':                'mono',
            // Avocat
            'Avocat':                'bi',
        };

export { VARIETE_CYCLE_CONFIG };
