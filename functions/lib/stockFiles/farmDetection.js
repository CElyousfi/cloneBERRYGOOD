'use strict';
// @ts-check

/**
 * farmDetection.js — Désambiguïsation FERME à partir de la légende (caption)
 * d'un document/image envoyé au bot WhatsApp magasinier. PUR, testable en
 * node:test. Voir docs/spec-collecte-stock-magasinier.md §2 (stratégie à
 * 2 niveaux) et §4.5 (canal WhatsApp entrant).
 *
 * Niveau 1 (ce module) : si la légende contient un mot-clé sans ambiguïté
 * ("BG"/"Berry Good"/"Bahia", insensible casse/accents) → ferme déduite,
 * pas de question. Sinon `magasinierBot.js` bascule au niveau 2 (boutons
 * interactifs + session `whatsapp_sessions/{phone}`).
 */

const BERRY_GOOD_KEYWORDS = ['bg', 'berry good', 'berrygood', 'berry-good'];
const BAHIA_KEYWORDS = ['bahia'];

/**
 * Normalise une chaîne pour la recherche de mot-clé : minuscule, accents
 * retirés (NFD), espaces superflus trim.
 * @param {string|null|undefined} s
 * @returns {string}
 */
function normalize(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Détecte la ferme visée par une légende WhatsApp, SANS ambiguïté.
 * Retourne `null` si aucun mot-clé net n'est trouvé, ou si les deux fermes
 * sont mentionnées (ambiguïté volontaire → le bot doit alors demander).
 * @param {string|null|undefined} caption
 * @returns {'berry_good'|'bahia'|null}
 */
function detectFarmFromCaption(caption) {
  const n = normalize(caption);
  if (!n) return null;
  const hasBg = BERRY_GOOD_KEYWORDS.some((k) => n.indexOf(k) >= 0);
  const hasBahia = BAHIA_KEYWORDS.some((k) => n.indexOf(k) >= 0);
  if (hasBg && hasBahia) return null;
  if (hasBg) return 'berry_good';
  if (hasBahia) return 'bahia';
  return null;
}

module.exports = { detectFarmFromCaption };
