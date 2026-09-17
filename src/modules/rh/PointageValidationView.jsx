// PointageValidationView — point d'entrée du menu « Validation du pointage ».
//
// Branche le menu sur le NOUVEAU workflow de validation par équipe/ferme
// (PointageValidationPanel + /api/pointage-validation), en remplacement de
// l'ancien PointageTab(isValidation) visa-chain (débranché de l'UI, code
// backend ancien conservé pour un lot ultérieur).
//
// Rôle de cette vue :
//   1. Calculer le périmètre ferme selon le profil (scoping chef de ferme).
//   2. Rendre PointageTab en mode validation, lequel construit equipesParFerme
//      depuis le pipeline de données du Pointage du jour et rend le panneau
//      PointageValidationPanel (déjà filtré par farmFilter).
//
// Scoping (décision Omar) :
//   - chef_f1 → F1, chef_f5 → F5, chef_avo → Avocatier, chef_bahia → BAHIA :
//     ne voit QUE sa ferme.
//   - RH / DG (et autres) → farmFilter vide = toutes les fermes.

import { PointageTab } from './PointageTab.jsx';

// Mapping profil chef → ferme (miroir UI de CHEF_FERME_BY_PROFILE backend).
var CHEF_FERME = { chef_f1: 'F1', chef_f5: 'F5', chef_avo: 'Avocatier', chef_bahia: 'BAHIA' };

function PointageValidationView(props) {
  var data = props.data;
  var currentProfile = props.currentProfile;
  var avoSubFilter = props.avoSubFilter;

  // Scoping par ferme selon le profil. Vide = toutes (RH/DG).
  var farmFilter = CHEF_FERME[currentProfile] || '';

  if (!PointageTab) {
    return React.createElement(
      'div',
      { style: { padding: 24, color: 'var(--red)' } },
      'Module Pointage indisponible.'
    );
  }

  return React.createElement(PointageTab, {
    data: data,
    farmFilter: farmFilter,
    avoSubFilter: avoSubFilter,
    currentProfile: currentProfile,
    isValidation: true,
  });
}

export { PointageValidationView };
