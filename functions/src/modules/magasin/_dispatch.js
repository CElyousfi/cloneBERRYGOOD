/* Sentinelle de non-prise-en-charge.
   Un handler d'action retourne la valeur de res.json()/res.status() quand il
   traite l'action. Pour distinguer « je n'ai pas traite » d'un retour legitime,
   on utilise un Symbol : aucune valeur applicative ne peut lui etre egale. */
'use strict';
const NOT_HANDLED = Symbol("stock.action.not-handled");
module.exports = { NOT_HANDLED };
