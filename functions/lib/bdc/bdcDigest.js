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
 * Cas « aucun valideur » : quand `chefProfileForFerme()` ne renvoie rien pour
 * un BdC en `en_attente_chef` (ferme direct-DG soumise avec un statut
 * incohérent, ou ferme inconnue — `requiresChefValidation()` est fail-safe
 * `true`, donc une simple typo de ferme y mène), on N'IMPUTE PAS ces BdC au
 * DG : il ne peut techniquement pas les débloquer (bdcValidationService.js
 * refuse une validation DG sur un BdC `en_attente_chef`), et les compter dans
 * son bucket fausserait `byBlocker` en nombre ET en montant. Ils reçoivent un
 * rôle distinct `aucun_valideur`, cohérent avec `remind-bdc` qui produit
 * `profiles = []` dans ce cas.
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
  aucun_valideur: 'Bloqué — aucun chef de ferme',
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
    // Aucun chef compétent : rôle distinct, surtout PAS le DG (il ne peut pas
    // valider un BdC en_attente_chef → l'imputer au DG fausse byBlocker).
    return { role: 'aucun_valideur', label: `Bloqué — aucun chef pour ${ferme || 'ferme inconnue'}`, ferme };
  }
  return { role: 'inconnu', label: `Inconnu (statut "${status || 'absent'}")`, ferme };
}

/**
 * Âge en jours pleins d'un BdC depuis sa dernière mise à jour.
 *
 * @param {BdcDoc} bdc
 * @param {number} todayMs - horodatage de référence (epoch ms).
 * @returns {number|null} nombre de jours (jamais négatif : une date future est
 *   clampée à 0), ou `null` si le BdC n'a AUCUNE date exploitable — afficher
 *   « 0 j » sur un BdC potentiellement ancien serait trompeur.
 */
function ageJoursOf(bdc, todayMs) {
  const ts = toNumber((bdc && bdc.updated_at) || (bdc && bdc.created_at));
  if (!ts) return null;
  return Math.max(0, Math.floor((todayMs - ts) / MS_PER_DAY));
}

/**
 * Convertit le paramètre `today` (Date | epoch ms | ISO string) en epoch ms.
 * Échec BRUYANT si la valeur est absente ou invalide : le module existe pour
 * être déterministe, un fallback silencieux mettrait tous les `ageJours` à 0
 * sans que personne ne le voie.
 *
 * @param {Date|number|string} today
 * @returns {number}
 * @throws {Error} si `today` est absent ou non parsable.
 */
function toTodayMs(today) {
  if (today instanceof Date && isFinite(today.getTime())) return today.getTime();
  if (typeof today === 'number' && isFinite(today)) return today;
  if (typeof today === 'string') {
    const parsed = Date.parse(today);
    if (isFinite(parsed)) return parsed;
  }
  throw new Error('bdcDigest: option "today" requise (Date, epoch ms ou string ISO valide)');
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
 *   items: Array<{numero: string, fournisseur: string, ferme: string|null, totalTtc: number, status: string, blockedBy: Blocker, ageJours: number|null}>
 * }}
 * @throws {Error} si `options.today` est absent ou invalide.
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

  // Tri : le plus vieux d'abord ; les BdC sans date exploitable (ageJours null)
  // partent en fin de liste plutôt que de squatter la tête du classement.
  items.sort((a, b) => {
    if (a.ageJours === null && b.ageJours === null) return a.numero.localeCompare(b.numero);
    if (a.ageJours === null) return 1;
    if (b.ageJours === null) return -1;
    return (b.ageJours - a.ageJours) || a.numero.localeCompare(b.numero);
  });

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

/** Nombre de BdC détaillés renvoyés au modèle par défaut. */
const DEFAULT_ITEMS_LIMIT = 15;

/**
 * Met en forme le résumé pour l'appelant (tool LLM) : borne la liste `items`
 * à `limit` tout en conservant les totaux calculés sur TOUT le jeu de données
 * (total, totalTtc, byBlocker) — sinon les chiffres annoncés seraient faux.
 *
 * @param {ReturnType<typeof summarizePendingValidation>} summary
 * @param {number|string|undefined} limit - défaut 15, minimum 1.
 * @param {{ ferme?: string, tronque?: boolean }} [options] - `ferme` = filtre
 *   appliqué en amont (informatif), `tronque` = la lecture source a atteint son
 *   plafond, donc les totaux sont partiels.
 * @returns {{ferme: string, total: number, totalTtc: number, byBlocker: Array<object>, items: Array<object>, reste?: number, lectureTronquee?: true}}
 */
function buildDigestPayload(summary, limit, options) {
  const opts = options || {};
  const parsed = parseInt(String(limit), 10);
  const max = isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ITEMS_LIMIT;
  const items = summary.items.slice(0, max);

  /** @type {any} */
  const payload = {
    ferme: (opts.ferme && String(opts.ferme).trim()) || 'toutes',
    total: summary.total,
    totalTtc: summary.totalTtc,
    byBlocker: summary.byBlocker,
    items,
  };
  if (summary.total > items.length) payload.reste = summary.total - items.length;
  if (opts.tronque) payload.lectureTronquee = true;
  return payload;
}

module.exports = { PENDING_STATUSES, ROLE_LABELS, DEFAULT_ITEMS_LIMIT, blockedBy, summarizePendingValidation, buildDigestPayload }
