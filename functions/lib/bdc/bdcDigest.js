/**
 * bdcDigest.js — Helpers purs pour les digests BdC (« en attente de
 * validation » et « non réceptionnés ») consommés par le bot WhatsApp
 * assistant DG (functions/dgAgent.js).
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
const {
  computeReceivedByArticle,
  computeOrderedByArticle,
  deriveDeliveryStatus,
  RELIQUAT_EPSILON,
} = require('./receptionGuard.js');

/** Statuts d'un BdC qui attend encore une validation. */
const PENDING_STATUSES = ['brouillon', 'en_attente_chef', 'en_attente_dg'];

/**
 * Statuts d'un BdC qui peut être réceptionné (un BL peut y être rattaché).
 * MÊMES valeurs que la garde de l'action `create-bl` (functions/index.js) et
 * que le chargement de l'onglet magasin (public/components/MagBdcReceptionTab.jsx)
 * — les trois doivent lister exactement les mêmes BdC.
 */
const RECEIVABLE_STATUSES = ['valide_dg', 'envoye', 'virement_lance', 'virement_signe'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Date de MISE EN SERVICE RÉELLE de l'application achats : 01/07/2026 à minuit
 * **heure marocaine** (UTC+1), soit `2026-06-30T23:00:00Z`.
 *
 * Le décalage est délibéré. Écrire `2026-07-01T00:00:00Z` — plus lisible, et
 * cohérent avec le parsing UTC de `date_livraison_prevue` plus bas — placerait
 * en réalité le seuil à 01h00 locale : un BdC créé entre minuit et 1h du matin
 * le 1er juillet serait écarté à tort. Probabilité infime, mais l'erreur irait
 * dans le sens de l'INVISIBILITÉ, et c'est le seul sens qu'on refuse ici.
 *
 * Avant cette date, l'app n'était pas utilisée au quotidien : les BdC existent
 * (import historique au préfixe `BC-`, premières saisies d'avril-mai) mais les
 * RÉCEPTIONS n'ont jamais été saisies. Ces BdC apparaissent donc éternellement
 * « 0 % reçu, 130 j de retard » alors que la marchandise est livrée depuis des
 * mois. Les lister pousse le DG à relancer des fournisseurs pour du bruit.
 *
 * Sert UNIQUEMENT à borner le digest « non réceptionnés » du bot DG. Aucune
 * écriture, aucun filtre Firestore : les documents restent intégralement
 * lisibles ailleurs (rapprochement des factures via `Num_BC`, `get_bdc_detail`).
 */
const MISE_EN_SERVICE_MS = Date.parse('2026-06-30T23:00:00.000Z');

/** Libellé humain du seuil, pour le prompt système — évite de dupliquer la date. */
const MISE_EN_SERVICE_LABEL = '01/07/2026';

/**
 * Le BdC est-il à retenir au titre de la mise en service ?
 *
 * Prédicat écrit EN POSITIF à dessein : on n'écarte que ce qu'on SAIT être
 * antérieur au seuil. Toute date inexploitable (`created_at` absent, `null`,
 * `0`, `NaN`, ou d'un autre type que `number`) → le BdC est CONSERVÉ. Un BdC
 * en trop se voit et se corrige ; un BdC rendu invisible ne se voit pas.
 *
 * `created_at` est le seul champ utilisable ici : `updated_at` est réécrit à
 * chaque création/suppression de BL (un vieux BdC touché récemment passerait le
 * filtre) et `date_livraison_prevue` est une échéance, pas une date de création
 * (et peut valoir "").
 *
 * Borne INCLUSIVE : un BdC créé exactement à la milliseconde du seuil est
 * conservé.
 *
 * @param {BdcDoc} bdc
 * @returns {boolean} true = à garder dans le digest.
 */
function isDepuisMiseEnService(bdc) {
  const ts = bdc && bdc.created_at;
  if (typeof ts !== 'number' || !isFinite(ts) || ts <= 0) return true;
  return ts >= MISE_EN_SERVICE_MS;
}

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

// ============================================================================
// Réception — « quels BdC ne sont pas encore réceptionnés ? »
//
// Le reliquat n'est PAS relu sur le document : `delivery_status` est un champ
// matérialisé qui peut diverger de la réalité des BL (BL supprimé après coup,
// écriture partielle, import). On le RECALCULE systématiquement à partir des
// BL, via les helpers de receptionGuard.js — la même logique que la garde
// serveur `create-bl`, donc jamais deux vérités sur le reliquat.
//
// Les BL soft-deleted (`bl.deleted`) sont écartés ici EN PLUS du filtre côté
// lecture Firestore : un BL supprimé encore compté gonflerait le reçu et
// masquerait un BdC réellement non réceptionné.
// ============================================================================

/**
 * @typedef {{ article?: string, quantite?: number|string, unite?: string }} BdcItemDoc
 * @typedef {{ deleted?: boolean, items?: Array<{article?: string, quantite_recue?: number}> }} BlDoc
 * @typedef {BdcDoc & { id?: string, items?: BdcItemDoc[], date_livraison_prevue?: string|number|null }} BdcReceptionDoc
 */

/**
 * Écarte les BL soft-deleted. Point de passage UNIQUE : toute lecture de BL
 * dans ce module passe par ici.
 *
 * @param {BlDoc[]|undefined|null} bls
 * @returns {BlDoc[]}
 */
function liveBls(bls) {
  return (bls || []).filter((bl) => bl && !bl.deleted);
}

/**
 * Retrouve les BL d'un BdC dans la table injectée par l'appelant.
 * Clé attendue = l'id Firestore du document ; le numéro est accepté en repli
 * (utile en test et si l'appelant n'a pas propagé l'id).
 *
 * @param {BdcReceptionDoc} bdc
 * @param {Record<string, BlDoc[]>|undefined|null} blsByBdcId
 * @returns {BlDoc[]} BL vivants uniquement.
 */
function blsOf(bdc, blsByBdcId) {
  const table = blsByBdcId || {};
  const byId = bdc && bdc.id ? table[bdc.id] : null;
  const byNumero = !byId && bdc && bdc.numero ? table[String(bdc.numero)] : null;
  return liveBls(byId || byNumero);
}

/**
 * Convertit une date d'échéance (`date_livraison_prevue`, stockée en string
 * "YYYY-MM-DD" ou en epoch ms) en epoch ms.
 *
 * @param {string|number|null|undefined} value
 * @returns {number|null} null si absente ou non parsable.
 */
function dueDateMs(value) {
  if (typeof value === 'number' && isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value.trim());
    if (isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Détail article par article d'un BdC : commandé, livré, reliquat.
 *
 * Un article livré mais ABSENT du BdC est tout de même listé (`qCmd` 0) —
 * c'est une incohérence de données qu'il vaut mieux montrer que masquer.
 *
 * @param {BdcReceptionDoc} bdc
 * @param {BlDoc[]} bls - BL du BdC (les soft-deleted sont écartés ici).
 * @returns {Array<{article: string, unite: string, qCmd: number, qLiv: number, reliquat: number}>}
 */
function detailArticles(bdc, bls) {
  const items = (bdc && bdc.items) || [];
  const ordered = computeOrderedByArticle(items);
  const received = computeReceivedByArticle(liveBls(bls));

  /** @type {Record<string, string>} */
  const unites = {};
  items.forEach((it) => {
    const art = it && it.article;
    if (art && !unites[art] && it.unite) unites[art] = String(it.unite);
  });

  const articles = Object.keys(ordered);
  Object.keys(received).forEach((art) => { if (articles.indexOf(art) === -1) articles.push(art); });

  return articles.map((article) => {
    const qCmd = round2(ordered[article] || 0);
    const qLiv = round2(received[article] || 0);
    return { article, unite: unites[article] || '—', qCmd, qLiv, reliquat: round2(Math.max(0, qCmd - qLiv)) };
  });
}

/**
 * Agrège les BdC réceptionnables qui ne sont PAS encore soldés.
 *
 * @param {BdcReceptionDoc[]} bdcs - documents `purchase_orders` déjà filtrés
 *   sur RECEIVABLE_STATUSES par l'appelant (re-filtrés ici par sécurité).
 * @param {Record<string, BlDoc[]>} blsByBdcId - BL par id de BdC (lus ailleurs).
 * @param {{ today: Date|number|string, enRetardSeulement?: boolean }} options
 * @returns {{
 *   total: number,
 *   totalTtc: number,
 *   enRetard: number,
 *   byDeliveryStatus: Array<{status: string, count: number, totalTtc: number}>,
 *   items: Array<{numero: string, fournisseur: string, ferme: string|null, totalTtc: number, deliveryStatus: string, dateLivraisonPrevue: string|null, retardJours: number|null, pctRecu: number, nbArticlesIncomplets: number}>
 * }}
 * @throws {Error} si `options.today` est absent ou invalide.
 */
function summarizePendingReception(bdcs, blsByBdcId, options) {
  const opts = options || /** @type {any} */ ({});
  const todayMs = toTodayMs(opts.today);

  const receivable = (bdcs || []).filter((b) => b && RECEIVABLE_STATUSES.indexOf(b.status || '') !== -1);

  const items = [];
  for (const bdc of receivable) {
    const bls = blsOf(bdc, blsByBdcId);
    const ordered = computeOrderedByArticle(bdc.items || []);
    const received = computeReceivedByArticle(bls);
    const deliveryStatus = deriveDeliveryStatus(ordered, received);
    // Soldé → hors périmètre. Ce filtre avale AUSSI le cas « BdC sans aucune
    // ligne d'article » : `deriveDeliveryStatus({}, {})` vaut 'complet' par
    // vacuité (`every` sur un objet vide est true). Ce n'est pas un bug —
    // un BdC sans article n'a rien à réceptionner — et le cas est de toute
    // façon inatteignable depuis l'app (`create-bdc` rejette items vide).
    if (deliveryStatus === 'complet') continue;

    let totalCmd = 0;
    let totalRecu = 0;
    let nbArticlesIncomplets = 0;
    for (const article of Object.keys(ordered)) {
      const cmd = ordered[article] || 0;
      const recu = received[article] || 0;
      totalCmd += cmd;
      // Reçu plafonné au commandé par article : une sur-réception sur un
      // article ne doit pas compenser un manque sur un autre dans le %.
      totalRecu += Math.min(recu, cmd);
      if (cmd - recu > RELIQUAT_EPSILON) nbArticlesIncomplets += 1;
    }
    const pctRecu = totalCmd > 0 ? Math.round((totalRecu / totalCmd) * 1000) / 10 : 0;

    const dueMs = dueDateMs(bdc.date_livraison_prevue);
    const retardJours = dueMs === null ? null : Math.max(0, Math.floor((todayMs - dueMs) / MS_PER_DAY));

    items.push({
      numero: (bdc.numero && String(bdc.numero)) || '—',
      fournisseur: fournisseurNom(bdc),
      ferme: (typeof bdc.ferme === 'string' && bdc.ferme.trim()) ? bdc.ferme.trim() : null,
      totalTtc: round2(toNumber(bdc.total_ttc)),
      deliveryStatus,
      // Piège de fuseau (même nature qu'au lot 1) : `Date.parse("YYYY-MM-DD")`
      // rend minuit UTC et `toISOString()` reformate en UTC, alors que
      // `today` vient de `Date.now()`. Conséquence : la bascule « 0 j » →
      // « 1 j de retard » se produit à 01 h 00 heure marocaine (UTC+1) et non
      // à minuit local. Purement cosmétique sur un retard compté en jours —
      // ne pas « corriger » à moitié en mélangeant local et UTC.
      dateLivraisonPrevue: dueMs === null
        ? null
        : (typeof bdc.date_livraison_prevue === 'string'
          ? bdc.date_livraison_prevue.trim()
          : new Date(dueMs).toISOString().slice(0, 10)),
      retardJours,
      pctRecu,
      nbArticlesIncomplets,
    });
  }

  const kept = opts.enRetardSeulement
    ? items.filter((it) => it.retardJours !== null && it.retardJours > 0)
    : items;

  // Tri : le plus en retard d'abord, puis le moins servi ; échéance inconnue
  // en fin de liste (comme `ageJours: null` côté validation).
  kept.sort((a, b) => {
    if (a.retardJours === null && b.retardJours === null) return (a.pctRecu - b.pctRecu) || a.numero.localeCompare(b.numero);
    if (a.retardJours === null) return 1;
    if (b.retardJours === null) return -1;
    return (b.retardJours - a.retardJours) || (a.pctRecu - b.pctRecu) || a.numero.localeCompare(b.numero);
  });

  /** @type {Record<string, {status: string, count: number, totalTtc: number}>} */
  const buckets = {};
  let totalTtc = 0;
  let enRetard = 0;
  for (const it of kept) {
    totalTtc += it.totalTtc;
    if (it.retardJours !== null && it.retardJours > 0) enRetard += 1;
    if (!buckets[it.deliveryStatus]) buckets[it.deliveryStatus] = { status: it.deliveryStatus, count: 0, totalTtc: 0 };
    buckets[it.deliveryStatus].count += 1;
    buckets[it.deliveryStatus].totalTtc = round2(buckets[it.deliveryStatus].totalTtc + it.totalTtc);
  }
  const byDeliveryStatus = Object.keys(buckets)
    .map((k) => buckets[k])
    .sort((a, b) => (b.count - a.count) || a.status.localeCompare(b.status));

  return { total: kept.length, totalTtc: round2(totalTtc), enRetard, byDeliveryStatus, items: kept };
}

/**
 * Met en forme le résumé réception pour le tool LLM. Réutilise le bornage de
 * `buildDigestPayload` (limite + `reste` + `lectureTronquee`) et y ajoute les
 * agrégats propres à la réception, calculés sur TOUT le jeu de données.
 *
 * @param {ReturnType<typeof summarizePendingReception>} summary
 * @param {number|string|undefined} limit
 * @param {{ ferme?: string, tronque?: boolean, enRetardSeulement?: boolean, ecartesAvantMiseEnService?: number }} [options]
 * @returns {object}
 */
function buildReceptionPayload(summary, limit, options) {
  const opts = options || {};
  /** @type {Record<string, any>} */ // sac JSON pour le tool LLM : enrichi ci-dessous
  const payload = buildDigestPayload(/** @type {any} */ (summary), limit, opts);
  // `byBlocker` est un agrégat du digest validation : sans objet ici.
  delete payload.byBlocker;
  payload.enRetard = summary.enRetard;
  payload.byDeliveryStatus = summary.byDeliveryStatus;
  if (opts.enRetardSeulement) payload.enRetardSeulement = true;
  // Rien ne disparaît sans trace : le nombre de BdC antérieurs à la mise en
  // service est TOUJOURS exposé (y compris à 0), pour que le modèle puisse le
  // citer si on le lui demande.
  payload.ecartesAvantMiseEnService = toNumber(opts.ecartesAvantMiseEnService);
  return payload;
}

module.exports = { PENDING_STATUSES, RECEIVABLE_STATUSES, ROLE_LABELS, DEFAULT_ITEMS_LIMIT, MISE_EN_SERVICE_MS, MISE_EN_SERVICE_LABEL, isDepuisMiseEnService, blockedBy, summarizePendingValidation, buildDigestPayload, summarizePendingReception, detailArticles, buildReceptionPayload }
