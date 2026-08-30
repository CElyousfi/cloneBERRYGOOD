'use strict';

/**
 * articleHistoryIndex.js — Construit, en UN seul scan de stock_movements,
 * l'index du grand livre de TOUS les articles, puis sert la tranche d'un
 * article donné au format attendu par `get-article-history`.
 *
 * Motivation perf : `get-article-history` re-scannait les ~4000 stock_movements
 * (~3,4 s) à CHAQUE article ouvert/navigué dans la Fiche de Stock. On scanne
 * désormais une seule fois, on met l'index en cache mémoire (TTL 5 min), et
 * chaque article est servi instantanément depuis l'index.
 *
 * La SÉMANTIQUE est IDENTIQUE à l'ancienne logique inline : mêmes exclusions
 * (isDeletedMovement, reception/sortie → valide_chef), mêmes lieux de stock
 * (magasin|station), mêmes cumuls et arrondis.
 */

const { canon } = require('./articleKey');

const STOCK_LIEU_TYPES = ['magasin', 'station'];

function isStockLieu(lieu) {
  return !!(lieu && typeof lieu === 'object' && lieu.id && STOCK_LIEU_TYPES.includes(lieu.type));
}

/**
 * Construit l'index complet { [articleKeyCanon]: { rawEntries, movements, article } }.
 * articleKeyCanon = clé canonique (article_ref OU article_nom passés par `canon`).
 * Un même mouvement/item est indexé sous SES clés (ref ET nom) pour préserver le
 * matching actuel (article_ref OU article_nom).
 *
 * @param {Array<{id: string, data: () => object}>} docs - docs Firestore stock_movements
 * @param {{ isDeletedMovement: (m: object) => boolean }} guard
 * @returns {Object} index par clé article (lowercase)
 */
function buildArticleHistoryIndex(docs, guard) {
  /** @type {Object<string, {rawEntries: Array, movements: Object, article: {ref:string,nom:string,unite:string}}>} */
  const index = {};

  function bucket(key, ref, nom, unite) {
    if (!index[key]) {
      index[key] = { rawEntries: [], movements: {}, article: { ref, nom, unite } };
    }
    return index[key];
  }

  for (const doc of docs) {
    const m = doc.data();
    if (guard.isDeletedMovement(m)) continue; // exclusion défensive soft-delete
    const needsMulti = m.type === 'reception' || m.type === 'sortie';
    if (needsMulti && m.status !== 'valide_chef') continue;
    if (!m.status) continue;

    for (const item of (m.items || [])) {
      const ref = item.article_ref || '';
      const nom = item.article_nom || '';
      const qty = parseFloat(item.quantite) || 0;
      const unite = item.unite || 'kg';
      if (qty <= 0) continue;

      // Clés de matching : ref ET nom, CANONISÉES (cf. lib/stock/articleKey.js).
      // La canonicalisation doit être appliquée aux DEUX bouts du chemin
      // (indexation ici, recherche dans sliceArticleHistory) : la faire d'un
      // seul côté ne réconcilie que les articles déjà écrits en majuscules.
      const kRef = canon(ref);
      const kNom = canon(nom);
      const keys = [];
      if (kRef) keys.push(kRef);
      if (kNom && kNom !== kRef) keys.push(kNom);
      if (keys.length === 0) continue;

      for (const key of keys) {
        const b = bucket(key, ref, nom, unite);

        if (isStockLieu(m.lieu_source)) {
          b.rawEntries.push({
            date: m.date, numero: m.numero || '', type: m.type,
            lieu_type: m.lieu_source.type, lieu_id: m.lieu_source.id,
            sens: 'sortie', quantite: -qty, unite, status: m.status, movementId: doc.id,
          });
        }
        if (isStockLieu(m.lieu_destination)) {
          b.rawEntries.push({
            date: m.date, numero: m.numero || '', type: m.type,
            lieu_type: m.lieu_destination.type, lieu_id: m.lieu_destination.id,
            sens: 'entree', quantite: qty, unite, status: m.status, movementId: doc.id,
          });
        }

        // Détail du bon (dédupliqué par id) pour le popup front.
        if (!b.movements[doc.id]) {
          b.movements[doc.id] = {
            numero: m.numero || '', type: m.type, date: m.date,
            lieu_source: m.lieu_source || null, lieu_destination: m.lieu_destination || null,
            ref_bl_fournisseur: m.ref_bl_fournisseur || null, fournisseur_nom: m.fournisseur_nom || null,
            sortie_type: m.sortie_type || null, beneficiaire: m.beneficiaire || null,
            motif_rebut: m.motif_rebut || null, items: m.items || [], status: m.status,
            created_by: m.created_by || null, created_at: m.created_at || null,
            scan_url: m.scan_url || null, validations: m.validations || null,
          };
        }
      }
    }
  }

  return index;
}

/**
 * Sert la tranche d'un article depuis l'index, au format EXACT de l'ancienne
 * réponse `get-article-history` (hors champ `success` ajouté par l'appelant).
 *
 * @param {Object} index - sortie de buildArticleHistoryIndex
 * @param {string} articleParam - article_ref ou article_nom (brut)
 * @param {string|null} filterLieuId - filtre optionnel par lieu_id
 * @returns {{article: object, entries: Array, soldes_par_lieu: Array, solde_global: number, movements: Object, count: number}}
 */
function sliceArticleHistory(index, articleParam, filterLieuId) {
  // Recherche par clé CANONIQUE — même règle que l'indexation (articleKey.js).
  const bucket = index[canon(articleParam)];

  const rawEntries = bucket ? bucket.rawEntries.slice() : [];
  const movements = bucket ? bucket.movements : {};
  const resolved = bucket ? bucket.article : { ref: '', nom: '', unite: '' };

  // Tri par date asc puis numero (cumul global cohérent)
  rawEntries.sort((a, b) => {
    if (a.date !== b.date) return (a.date || '') < (b.date || '') ? -1 : 1;
    return (a.numero || '').localeCompare(b.numero || '');
  });

  const cumul = {};
  let cumulGlobal = 0;
  const entries = rawEntries.map((e) => {
    const lieuKey = `${e.lieu_type}|${e.lieu_id}`;
    cumul[lieuKey] = (cumul[lieuKey] || 0) + e.quantite;
    cumulGlobal += e.quantite;
    return {
      ...e,
      quantite: Math.round(e.quantite * 100) / 100,
      cumul_apres: Math.round(cumul[lieuKey] * 100) / 100,
      cumul_global_apres: Math.round(cumulGlobal * 100) / 100,
    };
  });

  const soldes_par_lieu = Object.keys(cumul).map((k) => {
    const [lieu_type, lieu_id] = k.split('|');
    return { lieu_type, lieu_id, balance: Math.round(cumul[k] * 100) / 100 };
  }).filter((s) => Math.abs(s.balance) >= 0.01);

  const solde_global = Math.round(soldes_par_lieu.reduce((s, b) => s + b.balance, 0) * 100) / 100;

  const filteredEntries = filterLieuId ? entries.filter((e) => e.lieu_id === filterLieuId) : entries;

  return {
    article: {
      ref: resolved.ref || articleParam,
      nom: resolved.nom || articleParam,
      unite: resolved.unite || 'kg',
    },
    entries: filteredEntries,
    soldes_par_lieu,
    solde_global,
    movements,
    count: filteredEntries.length,
  };
}

module.exports = { buildArticleHistoryIndex, sliceArticleHistory, isStockLieu, STOCK_LIEU_TYPES, canon };
