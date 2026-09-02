'use strict';
// @ts-check

/**
 * uniteConso — point d'entrée du module « unité de consommation ≠ unité de
 * stock » (ticket sb/unite-conversion).
 *
 * Un article peut être ACHETÉ dans une unité et DOSÉ dans une autre (Acide
 * Nitrique : stock en KG, fertigation en L). La fiche porte alors
 * `unite_consommation` et `stock_par_unite_consommation` (« 1 unité de
 * consommation = X unités de stock »), et ce module convertit la quantité
 * saisie vers l'unité où le solde est tenu. Il ne devine JAMAIS un facteur
 * manquant : la ligne est déclarée non convertible et signalée.
 *
 * 100 % pur : ni Firestore, ni réseau, ni horloge.
 */

const conversionUnite = require('./conversionUnite');

module.exports = conversionUnite;
