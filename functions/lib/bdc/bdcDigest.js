/**
 * bdcDigest.js — Helpers purs pour le digest « BdC en attente de validation »
 * consommé par le bot WhatsApp assistant DG (functions/dgAgent.js).
 *
 * Module backend uniquement, SANS accès Firestore : les documents
 * `purchase_orders` et la date du jour sont injectés en paramètre. C'est ce
 * qui rend le calcul testable (tests/unit/bdcDigest.test.js) et déterministe.
 *
 * Règle de ciblage : `blockedBy()` est aligné sur la table de l'action
 * `remind-bdc` (functions/index.js) — statut → profil destinataire — pour que
 * « qui bloque » (bot) et « qui serait relancé » (bouton Rappel) ne divergent
 * jamais :
 *   - en_attente_chef → bdcWorkflow.chefProfileForFerme(ferme)
 *   - en_attente_dg   → dg
 *   - brouillon       → pas encore soumis, donc toujours chez les achats
 *     (remind-bdc refuse le rappel dans ce statut : il n'y a rien à relancer
 *     chez un valideur, la balle est dans le camp du saisisseur).
 *
 * Hypothèse documentée : quand `chefProfileForFerme()` ne renvoie rien pour un
 * BdC en `en_attente_chef` (ferme direct-DG soumise avec un statut incohérent,
 * ou ferme inconnue), on retombe explicitement sur le DG plutôt que de
 * renvoyer `undefined` — le DG est le valideur par défaut de ces fermes
 * (cf. DIRECT_DG_FARMS dans workflow.js).
 */
// @ts-check
'use strict';

const bdcWorkflow = require('./workflow.js');

/** Statuts d'un BdC qui attend encore une validation. */
const PENDING_STATUSES = ['brouillon', 'en_attente_chef', 'en_attente_dg'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @typedef {{
 *   numero?: string,
 *   status?: string,
 *   ferme?: string,
 *   fournisseur?: {nom?: string}|string|null,
 *   total_ttc?: number|string,
 *   created_at?: number,
 *   updated_at?: number
 * }} BdcDoc
 * @typedef {{ role: string, label: string, ferme: string|null }} Blocker
 */

/**
 * Libellés lisibles (WhatsApp / français) par profileId technique.
 * @type {Record<string, string>}
 */
const ROLE_LABELS = {
  achats: 'Achats',
  chef_f1: 'Chef F1',
  chef_f5: 'Chef F5',
  dg: 'DG',
};

/**
 * Normalise un montant potentiellement stocké en string.
 *
 * @param {number|string|undefined|null} value
 * @returns {number} 0 si la valeur n'est pas numérique.
 */
function toNumber(value) {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return isFinite(n) ? n : 0;
}

/**
 * Arrondi monétaire à 2 décimales (évite le bruit flottant sur les sommes).
 *
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Extrait le NOM du fournisseur. Le champ Firestore est un objet `{nom}`,
 * mais on tolère une string historique.
 *
 * @param {BdcDoc} bdc
 * @returns {string} le nom, ou "—" si absent / mal formé.
 */
function fournisseurNom(bdc) {
  const f = bdc && bdc.fournisseur;
  if (!f) return '—';
  if (typeof f === 'string') return f.trim() || '—';
  if (typeof f === 'object' && typeof f.nom === 'string' && f.nom.trim()) return f.nom.trim();
  return '—';
}

/**
 * Détermine QUI bloque la validation d'un BdC, aligné sur `remind-bdc`.
 *
 * @param {BdcDoc} bdc
 * @returns {Blocker} `role` = profileId technique, `label` = libellé français.
 */
function blockedBy(bdc) {
  const ferme = (bdc && typeof bdc.ferme === 'string' && bdc.ferme.trim()) ? bdc.ferme.trim() : null;
  const status = (bdc && bdc.status) || '';

  if (status === 'brouillon') {
    return { role: 'achats', label: 'Achats (pas encore soumis)', ferme };
  }
  if (status === 'en_attente_dg') {
    return { role: 'dg', label: ROLE_LABELS.dg, ferme };
  }
  if (status === 'en_attente_chef') {
    const chef = bdcWorkflow.chefProfileForFerme(ferme || '');
    if (chef) return { role: chef, label: ROLE_LABELS[chef] || chef, ferme };
    // Fallback explicite : aucun chef compétent pour cette ferme → DG.
    return { role: 'dg', label: `DG (aucun chef pour ${ferme || 'ferme inconnue'})`, ferme };
  }
  return { role: 'inconnu', label: `Inconnu (statut "${status || 'absent'}")`, ferme };
}

/**
 * Âge en jours pleins d'un BdC depuis sa dernière mise à jour.
 *
 * @param {BdcDoc} bdc
 * @param {number} todayMs - horodatage de référence (epoch ms).
 * @returns {number} nombre de jours, jamais négatif.
 */
function ageJoursOf(bdc, todayMs) {
  const ts = toNumber((bdc && bdc.updated_at) || (bdc && bdc.created_at));
  if (!ts) return 0;
  return Math.max(0, Math.floor((todayMs - ts) / MS_PER_DAY));
}

/**
 * Convertit le paramètre `today` (Date | epoch ms | ISO string) en epoch ms.
 *
 * @param {Date|number|string} today
 * @returns {number}
 */
function toTodayMs(today) {
  if (today instanceof Date) return today.getTime();
  if (typeof today === 'number' && isFinite(today)) return today;
  const parsed = Date.parse(String(today));
  return isFinite(parsed) ? parsed : 0;
}

/**
 * Agrège les BdC en attente de validation : total, montant, répartition par
 * bloqueur et liste détaillée triée du plus ancien au plus récent.
 *
 * @param {BdcDoc[]} bdcs - documents `purchase_orders` (déjà lus ailleurs).
 * @param {{ today: Date|number|string }} options - date de référence injectée
 *   (jamais `new Date()` en interne : le calcul doit rester déterministe).
 * @returns {{
 *   total: number,
 *   totalTtc: number,
 *   byBlocker: Array<{role: string, label: string, count: number, totalTtc: number}>,
 *   items: Array<{numero: string, fournisseur: string, ferme: string|null, totalTtc: number, status: string, blockedBy: Blocker, ageJours: number}>
 * }}
 */
function summarizePendingValidation(bdcs, options) {
  const todayMs = toTodayMs((options || /** @type {any} */ ({})).today);
  const pending = (bdcs || []).filter((b) => b && PENDING_STATUSES.indexOf(b.status || '') !== -1);

  const items = pending.map((bdc) => {
    const blocker = blockedBy(bdc);
    return {
      numero: (bdc.numero && String(bdc.numero)) || '—',
      fournisseur: fournisseurNom(bdc),
      ferme: blocker.ferme,
      totalTtc: round2(toNumber(bdc.total_ttc)),
      status: bdc.status || '',
      blockedBy: blocker,
      ageJours: ageJoursOf(bdc, todayMs),
    };
  });

  items.sort((a, b) => (b.ageJours - a.ageJours) || a.numero.localeCompare(b.numero));

  /** @type {Record<string, {role: string, label: string, count: number, totalTtc: number}>} */
  const blockers = {};
  let totalTtc = 0;
  for (const it of items) {
    totalTtc += it.totalTtc;
    const key = it.blockedBy.role;
    if (!blockers[key]) {
      blockers[key] = { role: key, label: ROLE_LABELS[key] || it.blockedBy.label, count: 0, totalTtc: 0 };
    }
    blockers[key].count += 1;
    blockers[key].totalTtc = round2(blockers[key].totalTtc + it.totalTtc);
  }

  const byBlocker = Object.keys(blockers)
    .map((k) => blockers[k])
    .sort((a, b) => (b.count - a.count) || (b.totalTtc - a.totalTtc) || a.role.localeCompare(b.role));

  return { total: items.length, totalTtc: round2(totalTtc), byBlocker, items };
}

module.exports = { PENDING_STATUSES, ROLE_LABELS, blockedBy, summarizePendingValidation }
