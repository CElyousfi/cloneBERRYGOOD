/* Porté du monolithe (sync upstream 3a6576d..5cd084e) — verbatim.
   Module: caisse | Déclaration(s): CAISSE_STATUTS_EDITABLES, CAISSE_TYPES_EDITABLES, CAISSE_FIELD_LABELS */

// Statuts d'un bon de caisse encore modifiables (miroir UI de la garde
// backend update-transaction — la garde qui compte est côté serveur).
const CAISSE_STATUTS_EDITABLES = ['brouillon', 'soumis', 'a_revoir', 'rejete', 'valide'];
// Types saisis à la main (transferts et compte client exclus).
const CAISSE_TYPES_EDITABLES = ['alimentation', 'depense', 'sortie', 'paie', 'transport'];

// Libellés lisibles des champs, pour l'historique des modifications.
const CAISSE_FIELD_LABELS = {
    date: 'Date', montant: 'Montant', type: 'Type', caisse_id: 'Caisse',
    code_analytique: 'Code analytique', description: 'Description',
    matricule: 'Matricule', beneficiaire_nom: 'Bénéficiaire', files: 'Pièces jointes',
    ferme: 'Ferme', campagne: 'Campagne', culture: 'Culture', parcelle: 'Parcelle',
};

export { CAISSE_STATUTS_EDITABLES, CAISSE_TYPES_EDITABLES, CAISSE_FIELD_LABELS };
