'use strict';

/**
 * Contrat de SOURCE sur MagReceptionTab (public/app.jsx).
 *
 * MÊME NATURE, MÊMES LIMITES que
 * functions/lib/receptionValorisation/__tests__/createBlContrat.test.js : c'est
 * un filet FAIBLE. `public/app.jsx` est un monolithe de 69 000 lignes sans
 * bundler, non chargeable en test (pas de RTL sur ce dépôt, limitation connue).
 *
 * Ce qu'il protège vaut quand même la peine : le magasinier ne doit JAMAIS se
 * retrouver devant un bouton qui échoue. Depuis la suppression de la réception
 * libre, le serveur refuse une réception sans bon de commande ; si l'écran
 * appelait encore ce chemin, le bouton rendrait une erreur — et le magasinier
 * conclurait que l'application est cassée, ce qui est pire que pas de bouton.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = require('./_sources').modulesSource();

/** Corps de MagReceptionTab, du début jusqu'au composant suivant. */
function composant() {
  const debut = SOURCE.indexOf('function MagReceptionTab(');
  assert.notEqual(debut, -1, 'MagReceptionTab introuvable dans public/app.jsx');
  const suite = SOURCE.slice(debut + 10);
  const relatif = suite.search(/\n {8}function [A-Z]/);
  assert.notEqual(relatif, -1, 'fin de MagReceptionTab introuvable');
  return SOURCE.slice(debut, debut + 10 + relatif);
}

test('MagReceptionTab ne crée plus aucune réception', () => {
  const c = composant();
  assert.ok(
    !c.includes("action=create-movement"),
    'le serveur refuse désormais une réception sans BDC : ce bouton rendrait une erreur'
  );
});

test('l\'écran n\'ÉCRIT plus reception_libre, mais continue de le LIRE', () => {
  // Distinction qui compte : les 2 réceptions libres de production portent
  // encore ces champs. Cesser de les AFFICHER effacerait leur motif de l'écran
  // sans effacer la donnée — de l'histoire rendue invisible. Seule l'ÉCRITURE
  // disparaît.
  const c = composant();
  assert.ok(
    !/reception_libre:\s*true/.test(c),
    'plus aucune écriture de reception_libre'
  );
  // On vise la ligne d'AFFICHAGE, pas n'importe quelle mention du champ : le
  // filtre de recherche le mentionne aussi, et se contenter de « le nom apparaît
  // quelque part » laisserait supprimer la pop-up sans rien casser.
  assert.ok(
    /infoRow\('Motif', r\.reception_libre_motif/.test(c),
    'le motif des 2 réceptions libres historiques doit rester lisible dans la pop-up de détail'
  );
  assert.ok(
    c.includes("r.reception_libre_motif || '').toLowerCase().includes(q)"),
    'ces bons doivent rester trouvables par leur motif dans la recherche'
  );
  assert.ok(
    c.includes("r.reception_libre ? 'Libre' : 'BDC'"),
    'le type des bons historiques doit rester affiché tel qu\'il est'
  );
});

test('le magasinier garde un chemin : le bouton redirige vers « BDC à réceptionner »', () => {
  const c = composant();
  assert.ok(
    c.includes("setCurrentTab('mag_bdc_reception')"),
    'sans redirection, le magasinier n\'a plus aucun point d\'entrée visible pour saisir une réception'
  );
  assert.ok(
    /Réceptionner un BDC/.test(c),
    'le bouton doit dire où il emmène'
  );
});

test('le bouton reçoit réellement setCurrentTab (sinon il ne fait rien)', () => {
  // Un bouton câblé sur une prop jamais transmise est un bouton mort SILENCIEUX :
  // il ne lève rien, il n'emmène nulle part.
  assert.ok(
    /function MagReceptionTab\(\{ currentProfile, profileData, setCurrentTab \}\)/.test(SOURCE),
    'MagReceptionTab doit déclarer la prop setCurrentTab'
  );
  assert.ok(
    /renderTab\('mag_reception', MagReceptionTab, \{[^}]*setCurrentTab[^}]*\}/.test(SOURCE),
    'le site d\'appel doit passer setCurrentTab, sinon le bouton est inerte'
  );
});

test('l\'onglet cible existe bien et est rendu pour les mêmes profils', () => {
  assert.ok(
    SOURCE.includes("renderTab('mag_bdc_reception'"),
    'la redirection pointerait vers un onglet inexistant'
  );
});

test('l\'onglet cible est dans le MENU du magasinier, pas seulement rendu', () => {
  // `renderTab` ne suffit pas : un onglet rendu mais absent de NAV_ITEMS_MAGASINIER
  // est atteignable une fois par le bouton, puis introuvable — le magasinier s'y
  // retrouve sans aucun moyen d'y revenir ni de comprendre où il est.
  const debut = SOURCE.indexOf('const NAV_ITEMS_MAGASINIER = [');
  assert.notEqual(debut, -1, 'NAV_ITEMS_MAGASINIER introuvable');
  const menu = SOURCE.slice(debut, SOURCE.indexOf('];', debut));
  assert.ok(
    menu.includes("id: 'mag_bdc_reception'"),
    'la cible de la redirection doit figurer dans le menu du magasinier'
  );
  assert.ok(
    menu.includes("id: 'mag_reception'"),
    'l\'onglet de départ doit rester dans le menu'
  );
});

test('la liste des bons de réception, elle, reste en place', () => {
  // La suppression du formulaire ne doit pas emporter la raison d'être de l'onglet.
  const c = composant();
  assert.ok(c.includes("action=list-movements&type=reception"), 'la liste a disparu avec le formulaire');
  assert.ok(c.includes('setDetailReception'), 'la pop-up de détail a disparu avec le formulaire');
});

// --------------------------------------------------------------------------
// MagBdcReceptionTab — l'écran de saisie d'une réception à partir du BDC.
// Même filet FAIBLE (composant non chargeable en test, pas de RTL ici).
// --------------------------------------------------------------------------

const MAG_BDC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'components', 'MagBdcReceptionTab.jsx'),
  'utf8'
);

test('l\'écran de saisie ne fabrique aucune unité', () => {
  // Le pré-remplissage posait 'kg' quand la ligne du BDC n'avait pas d'unité.
  // Cette unité inventée redevenait ensuite un critère de refus du prix : le
  // magasinier voyait « kg » sans l'avoir saisi, et le prix disparaissait.
  assert.ok(
    !/unite:\s*it\.unite\s*\|\|\s*'kg'/.test(MAG_BDC),
    'aucune unité ne doit être fabriquée au pré-remplissage'
  );
  assert.ok(
    /unite:\s*it\.unite\s*\|\|\s*''/.test(MAG_BDC),
    'l\'absence d\'unité doit être conservée telle quelle'
  );
});

test('l\'écran annonce l\'entrée en stock, jamais une validation Achats', () => {
  assert.ok(
    MAG_BDC.includes('buildReceptionCreatedMessage'),
    'le message doit venir du helper testé, pas d\'une chaîne en dur'
  );
  assert.ok(
    !/En attente de valorisation Achats/.test(MAG_BDC),
    'cette étape n\'existe plus : l\'annoncer ferait attendre une validation qui ne viendra pas'
  );
});

// --------------------------------------------------------------------------
// AchatsScanBLTab — l'écran « Scan BL » des Achats, qui appelle create-bl
// directement. Son unité vient d'une lecture IA du BL fournisseur : quand le
// scan n'en extrait pas, fabriquer un « kg » remplit le champ AVANT le serveur,
// et le correctif serveur (`it.unite || ""`) ne peut plus rien rattraper.
//
// Risque dormant : bl_scans ne contient que 2 documents, aucun rattaché à un
// BL — cet écran n'a produit aucune réception à ce jour. Mais il est au menu
// Achats, un clic suffit.
// --------------------------------------------------------------------------

function composantScanBL() {
  const debut = SOURCE.indexOf('function AchatsScanBLTab(');
  assert.notEqual(debut, -1, 'AchatsScanBLTab introuvable dans public/app.jsx');
  const suite = SOURCE.slice(debut + 10);
  const relatif = suite.search(/\n {8}function [A-Z]/);
  assert.notEqual(relatif, -1, 'fin de AchatsScanBLTab introuvable');
  return SOURCE.slice(debut, debut + 10 + relatif);
}

test('l\'écran Scan BL ne fabrique aucune unité quand le scan n\'en lit pas', () => {
  const c = composantScanBL();
  assert.ok(
    !/unite:\s*it\.unite\s*\|\|\s*'kg'/.test(c),
    'une unité inventée ici est indiscernable d\'une unité réellement lue sur le BL'
  );
});

test('l\'écran Scan BL appelle bien create-bl (le chemin réécrit par ce lot)', () => {
  // Si ce n'était plus le cas, l'assertion ci-dessus protégerait un chemin mort
  // et laisserait le vrai chemin sans filet.
  const c = composantScanBL();
  assert.ok(c.includes("action=create-bl"), 'cet écran doit rester sur create-bl');
});
