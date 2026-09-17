/* Sentinelle : distingue « action non traitee » d'un retour applicatif.
   Un Symbol ne peut etre egal a aucune valeur metier. */
'use strict';
const NOT_HANDLED = Symbol("pointageService.not-handled");
module.exports = { NOT_HANDLED };
