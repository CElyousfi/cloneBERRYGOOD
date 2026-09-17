/* PONT TRANSITOIRE — à supprimer avec le dernier composant de public/components.
 *
 * Les composants encore chargés en <script> classique (public/components/*,
 * via lazyGlobalComponent) lisent leurs helpers sur `window`. Ces helpers sont
 * désormais des modules ES : ce fichier les republie sur window, le temps que
 * chaque composant legacy soit converti et importe directement. Une entrée
 * disparaît quand son dernier consommateur legacy est converti.
 */
import * as AnalytiqueUtils from './lib/analytiqueUtils.js';
import * as CampagneBudgetPivot from './lib/campagneBudgetPivot.js';
import * as CampagneBudgetQuinzaine from './lib/campagneBudgetQuinzaine.js';
import * as CampagneExportUtils from './lib/campagneExportUtils.js';
import * as CampagneParcelleQuinzaine from './lib/campagneParcelleQuinzaine.js';
import * as CampagneProduction from './lib/campagneProduction.js';
import * as CampagneRapprochement from './lib/campagneRapprochement.js';
import * as CampagneRythme from './lib/campagneRythme.js';
import * as CampagneUtils from './lib/campagneUtils.js';
import * as CultureUtils from './lib/cultureUtils.js';

Object.assign(window, {
  AnalytiqueUtils, CampagneBudgetPivot, CampagneBudgetQuinzaine, CampagneExportUtils,
  CampagneParcelleQuinzaine, CampagneProduction, CampagneRapprochement, CampagneRythme,
  CampagneUtils, CultureUtils,
});
