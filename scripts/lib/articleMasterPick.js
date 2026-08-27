'use strict'
// @ts-check

/**
 * Ré-export du module pur `functions/lib/stockMerge/masterSuggestion.js`.
 *
 * ── POURQUOI CE FICHIER NE CONTIENT PLUS DE RÈGLE ─────────────────────────
 * Il portait sa PROPRE règle de choix du maître (`prix_pmp` seul, puis
 * `nb_achats`), pendant que la pop-up de fusion en appliquait une autre
 * (cascade `prix_pmp` -> `prix_ht` -> `nb_achats`). Mesuré sur les 105 groupes
 * de production : les deux règles désignaient une fiche DIFFÉRENTE sur 26
 * groupes (MEGAFOL EN 10L, CODACIDE OIL, ALGA600, TOUCHDAWN, SERGOMILE L60 EN
 * 5L, …), et aucune des deux ne le signalait : la divergence était SILENCIEUSE.
 * Conséquence concrète : Omar fusionne quelques groupes à l'écran, lance ce
 * script pour le reste, et obtient des décisions contradictoires sur le même
 * catalogue.
 *
 * L'alignement ne coûte rien : mesuré sur le catalogue live, AUCUNE fusion n'a
 * jamais été exécutée (0 fiche désactivée, 0 `merged_into`, 105 groupes
 * intacts). Il n'y a donc aucune cohérence historique à préserver.
 *
 * ── SENS DE LA DÉPENDANCE ─────────────────────────────────────────────────
 * `scripts/` -> `functions/`, JAMAIS l'inverse : Firebase ne déploie que
 * `functions/`, un `require('../scripts/…')` depuis le backend ferait crasher
 * TOUTES les Cloud Functions au chargement.
 *
 * Divergence de règle entre les deux chemins = échec de
 * tests/unit/articleMasterPick.test.js.
 */

module.exports = require('../../functions/lib/stockMerge/masterSuggestion')
