/* Module: caisse | Déclaration(s): ENC_BRUT_VIDE */


// Affiche une valeur BRUTE lue dans le fichier (rejets/doublons). Priorité
        // au champ `brut` exposé par parseEncaissements ; fallback sur `donnees`
        // (row brute) pour compat. Vide -> « (vide) » discret.
        const ENC_BRUT_VIDE = React.createElement('span', { style: { color: 'var(--gray-400)', fontStyle: 'italic' } }, '(vide)');

export { ENC_BRUT_VIDE };
