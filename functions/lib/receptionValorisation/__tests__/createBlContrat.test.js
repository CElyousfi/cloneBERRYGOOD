'use strict';

/**
 * createBlContrat.test.js — Contrat de SOURCE sur le bloc `create-bl` du
 * monolithe `functions/index.js`.
 *
 * CE QUE CES TESTS SONT, ET CE QU'ILS NE SONT PAS.
 *
 * `functions/index.js` ne peut pas être chargé en test (il initialise
 * firebase-functions au require). Deux faits décisifs y vivent donc hors de
 * portée d'un test de comportement :
 *   1. `applyStockImpact` est bien APPELÉ après l'écriture de la réception ;
 *   2. le chemin de reprise `en_attente_achats` est toujours LÀ.
 *
 * Sans filet, ces deux faits peuvent disparaître sans qu'aucun des 4000 tests
 * du dépôt ne bronche — et la marchandise cesserait silencieusement d'entrer en
 * stock, exactement le défaut que ce chantier corrige.
 *
 * Ces tests lisent donc le SOURCE. C'est un filet FAIBLE : il prouve qu'un
 * appel est écrit, pas qu'il s'exécute. Il est là parce qu'il vaut mieux qu'un
 * silence, pas parce qu'il vaut un test de comportement. Tout ce qui POUVAIT
 * être testé pour de vrai a été déplacé dans `receptionBdc.js` (statut, lignes,
 * prix, résumé) et l'est dans receptionBdc.test.js.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = path.join(__dirname, '..', '..', '..', 'index.js');
const SOURCE = fs.readFileSync(INDEX, 'utf8');

/**
 * Retire les commentaires de ligne d'un extrait de source.
 *
 * Les assertions doivent porter sur du CODE. Sans ça, un commentaire qui
 * EXPLIQUE qu'on ne crée plus de `en_attente_achats` ferait échouer le test
 * censé vérifier qu'on n'en crée plus — et la seule façon de le faire passer
 * serait de retirer l'explication. Un filet qui punit la documentation.
 * @param {string} src
 * @returns {string}
 */
function sansCommentaires(src) {
  return src
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
}

/** Extrait le corps du bloc `create-bl` (de sa garde jusqu'au bloc suivant). */
function blocCreateBl() {
  const debut = SOURCE.indexOf('if (action === "create-bl" && req.method === "POST")');
  assert.notEqual(debut, -1, 'bloc create-bl introuvable dans functions/index.js');
  const fin = SOURCE.indexOf('// ========== STOCK LEVELS ==========', debut);
  assert.notEqual(fin, -1, 'fin du bloc create-bl introuvable');
  return sansCommentaires(SOURCE.slice(debut, fin));
}

test('create-bl construit la réception via le module pur (aucune décision dans le monolithe)', () => {
  const bloc = blocCreateBl();
  assert.ok(
    bloc.includes('receptionBdc.construireMouvementReception('),
    'create-bl doit déléguer la construction au module pur'
  );
});

test('create-bl applique l\'impact stock à la création', () => {
  const bloc = blocCreateBl();
  assert.ok(
    /await applyStockImpact\(brMovement\)/.test(bloc),
    'sans cet appel, la marchandise n\'entre jamais en stock — le défaut que ce chantier corrige'
  );
});

test('create-bl n\'écrit plus de prix en dur, ni de zéro par défaut', () => {
  const bloc = blocCreateBl();
  assert.ok(
    !/prix_unitaire\s*:/.test(bloc),
    'aucun prix ne doit être décidé dans le monolithe : c\'est le rôle du module pur'
  );
  assert.ok(
    !/\|\|\s*0\s*\)\s*:\s*0/.test(bloc),
    'le double zéro par défaut (`(parseFloat(...) || 0) : 0`) ne doit pas revenir'
  );
});

test('create-bl ne crée plus de réception en attente de validation Achats', () => {
  const bloc = blocCreateBl();
  assert.ok(
    !bloc.includes('en_attente_achats'),
    'une réception créée en en_attente_achats reste hors stock indéfiniment'
  );
});

test('le chemin de reprise des réceptions bloquées est conservé', () => {
  // Hors du bloc create-bl : dans validate-movement. Le supprimer enfermerait
  // les réceptions déjà en `en_attente_achats` dans un statut mort, sans aucune
  // action capable de les faire entrer en stock. (62 au 27/08/2026 ; pas de
  // compte figé dans ce test — il vieillirait à chaque nouvelle réception.)
  assert.ok(
    SOURCE.includes('if (mov.status === "en_attente_achats")'),
    'chemin de reprise supprimé : les réceptions bloquées deviendraient invalidables'
  );
  assert.ok(
    SOURCE.includes('CHEMIN DE REPRISE — NE PAS SUPPRIMER'),
    'le chemin de reprise doit rester explicitement signalé comme tel'
  );
});

// --------------------------------------------------------------------------
// create-movement — le second chemin de création d'une réception.
// Même filet FAIBLE, mêmes limites : il prouve qu'un appel est écrit.
// --------------------------------------------------------------------------

/** Extrait le corps du bloc `create-movement`. */
function blocCreateMovement() {
  const debut = SOURCE.indexOf('if (action === "create-movement" && req.method === "POST")');
  assert.notEqual(debut, -1, 'bloc create-movement introuvable');
  const fin = SOURCE.indexOf('// --- LIST MOVEMENTS ---', debut);
  assert.notEqual(fin, -1, 'fin du bloc create-movement introuvable');
  return sansCommentaires(SOURCE.slice(debut, fin));
}

test('create-movement ne crée plus de réception en attente de validation Achats', () => {
  const bloc = blocCreateMovement();
  assert.ok(
    !bloc.includes('en_attente_achats'),
    'ce chemin créait des réceptions qui n\'entraient jamais en stock'
  );
});

test('create-movement prend son statut de réception dans la constante testée', () => {
  const bloc = blocCreateMovement();
  assert.ok(
    bloc.includes('receptionBdc.STATUT_RECEPTION_A_LA_CREATION'),
    'le statut doit venir du module, pas d\'une chaîne en dur dupliquée'
  );
});

test('create-movement valorise via le module pur (une seule règle de prix)', () => {
  const bloc = blocCreateMovement();
  assert.ok(
    bloc.includes('receptionBdc.valoriserItemsReception('),
    'sans ça, les deux chemins de réception pourraient diverger en silence'
  );
});

test('create-movement applique l\'impact exactement quand isImpactApplied le dit', () => {
  const bloc = blocCreateMovement();
  // La garde doit être le prédicat pur, pas une condition redevinée sur le type.
  // Une garde maison (`if (!isReception)`, `if (!needsMulti)`) exclurait les
  // réceptions de l'impact tout en les écrivant en `valide_chef` : les soldes
  // divergeraient du grand livre sans que rien ne le signale.
  assert.ok(
    /if \(isImpactApplied\(movData\)\) \{\s*\n\s*await applyStockImpact\(movData\);/.test(bloc),
    'la garde d\'impact doit être isImpactApplied(movData), et rien d\'autre'
  );
  assert.ok(
    !/if\s*\(!\s*(needsMulti|isReception)\s*\)/.test(bloc),
    'aucune garde maison ne doit exclure les réceptions de l\'impact stock'
  );
});

test('create-movement persiste ET renvoie le résumé de valorisation', () => {
  // Deux occurrences attendues : le champ écrit sur le mouvement (traçabilité
  // durable) et le champ renvoyé au front (avertissement immédiat). Perdre l'une
  // sans l'autre passait inaperçu.
  const bloc = blocCreateMovement();
  const occurrences = (bloc.match(/valorisation: receptionValorisation/g) || []).length;
  assert.equal(
    occurrences, 2,
    'le résumé doit être à la fois écrit sur le mouvement et renvoyé au front'
  );
});

test('le helper mort movementNeedsMultiValidation ne revient pas', () => {
  // Il affirmait que les réceptions restent en attente de validation Achats,
  // soit l'inverse du comportement réel. Un helper mort se lit comme une règle.
  assert.ok(
    !/function movementNeedsMultiValidation/.test(SOURCE),
    'helper mort réintroduit : il contredit le comportement réel'
  );
});

test('create-bl expose le numéro du bon de RÉCEPTION, distinct de celui du BL', () => {
  const bloc = blocCreateBl();
  assert.ok(
    /reception_numero:/.test(bloc),
    'sans ça le front annonce « Réception BL-0042 créée » — un document qui n\'existe pas sous ce nom'
  );
});

test('les deux chemins renvoient le résumé de valorisation au front', () => {
  // Sans lui, le magasinier n'apprend jamais qu'un article vient d'entrer en
  // stock sans prix : la quantité devient invisible dans les coûts en silence.
  assert.ok(/valorisation:/.test(blocCreateBl()), 'create-bl ne renvoie pas la valorisation');
  assert.ok(/valorisation: receptionValorisation/.test(blocCreateMovement()), 'create-movement ne renvoie pas la valorisation');
});

// --------------------------------------------------------------------------
// Réception libre supprimée — toute réception exige un bon de commande.
// --------------------------------------------------------------------------

test('create-movement refuse une réception sans bon de commande', () => {
  const bloc = blocCreateMovement();
  assert.ok(
    /if \(type === "reception" && !bdc_id\)/.test(bloc),
    'une réception sans BDC n\'a aucune source de prix : elle entrerait en stock sans jamais compter dans les coûts'
  );
});

test('le refus est ACTIONNABLE : il nomme l\'écran où aller', () => {
  const bloc = blocCreateMovement();
  const m = bloc.match(/error: "Une réception doit être rattachée[^"]*"/);
  assert.ok(m, 'message de refus introuvable');
  assert.ok(
    m[0].includes('BDC à réceptionner'),
    'un 400 sec laisse le magasinier sans issue : le message doit nommer l\'onglet'
  );
});

test('aucun chemin d\'écriture ne pose plus reception_libre sur une réception', () => {
  const bloc = blocCreateMovement();
  assert.ok(!/reception_libre:/.test(bloc), 'champ mort réintroduit dans create-movement');
  assert.ok(!/reception_libre:/.test(blocCreateBl()), 'champ mort réintroduit dans create-bl');
});

test('reception_libre_motif n\'est plus modifiable par edit-movement', () => {
  assert.ok(
    !/"reception_libre_motif"/.test(SOURCE),
    'le champ est mort : plus aucun chemin ne doit l\'écrire'
  );
});


// --------------------------------------------------------------------------
// Unités fabriquées et destination — deux règles qui ne vivent que dans le
// monolithe. Même filet FAIBLE que le reste de ce fichier.
// --------------------------------------------------------------------------

test('create-bl ne fabrique aucune unité sur les lignes du BL', () => {
  // Un « kg » inventé ici se propage dans le document BL, dans la ligne de stock,
  // puis servait de critère de refus de prix. 85,7 % des lignes de BDC en
  // production n'ont pas d'unité : l'invention est la norme, pas le cas limite.
  const bloc = blocCreateBl();
  assert.ok(
    !/unite:\s*it\.unite\s*\|\|\s*"kg"/.test(bloc),
    'aucune unité ne doit être fabriquée : unité absente = chaîne vide'
  );
  assert.ok(
    /unite:\s*it\.unite\s*\|\|\s*""/.test(bloc),
    'la ligne doit conserver explicitement l\'absence d\'unité'
  );
});

test('create-bl refuse en amont une réception sans destination', () => {
  // Sans cette garde, c'est le module qui lève — donc une 500 au lieu d'un 400
  // qui dit quoi faire. Le mouvement reste correct, le magasinier non.
  const bloc = blocCreateBl();
  assert.ok(
    /if \(!receptionBdc\.resoudreMagasinDestination\(req\.body\.magasin, bdc\)\)/.test(bloc),
    'la destination doit être vérifiée avant d\'écrire quoi que ce soit'
  );
  assert.ok(
    /code: "destination_requise"/.test(bloc),
    'le refus doit être identifiable par le client'
  );
});

test('create-bl ne compose plus la destination lui-même', () => {
  // La règle appartient au module : la réécrire ici la ferait diverger en silence.
  const bloc = blocCreateBl();
  assert.ok(
    !/magasin:\s*req\.body\.magasin\s*\|\|\s*bdc\.ferme/.test(bloc),
    'la résolution de destination doit rester dans resoudreMagasinDestination'
  );
  assert.ok(
    /magasinDemande: req\.body\.magasin,/.test(bloc),
    'create-bl transmet la demande, le module décide'
  );
});

test('create-movement ne fabrique aucune unité non plus', () => {
  // Le cinquième site. Inventer « kg » ici faisait PIRE qu'une absence : le
  // module comparait alors deux unités connues et différentes (BDC en L contre
  // « kg » inventé) et refusait le prix. Les deux chemins de création d'une
  // réception rendaient des résultats différents pour la MÊME livraison.
  const bloc = blocCreateMovement();
  assert.ok(
    !/unite:\s*it\.unite\s*\|\|\s*"kg"/.test(bloc),
    'create-movement doit conserver l\'absence d\'unité, comme create-bl'
  );
  assert.ok(
    /unite:\s*it\.unite\s*\|\|\s*""/.test(bloc),
    'l\'absence d\'unité doit être explicite'
  );
});

test('les DEUX chemins de réception appliquent la même règle d\'unité', () => {
  // Assertion jumelle sur les deux mappings du monolithe : c'est là que la
  // divergence est née, et un test alimenté à la main ne l'aurait pas vue.
  const regleFabrication = /unite:\s*it\.unite\s*\|\|\s*"kg"/;
  assert.ok(!regleFabrication.test(blocCreateBl()), 'create-bl fabrique une unité');
  assert.ok(!regleFabrication.test(blocCreateMovement()), 'create-movement fabrique une unité');
});
