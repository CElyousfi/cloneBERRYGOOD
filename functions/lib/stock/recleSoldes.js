'use strict';

// @ts-check

/**
 * recleSoldes.js — PLAN de RE-CLÉ des documents `stock_balances`.
 *
 * ── LE PROBLÈME, ET POURQUOI IL EST URGENT ────────────────────────────────
 * L'identifiant d'un document de solde est `${lieu_type}_${lieu_id}_${clé}`.
 * Historiquement, la « clé » était tantôt le LIBELLÉ tapé par le magasinier
 * (`create-bc`, `create-bl`, `create-movement`, les deux `reverse`), tantôt le
 * DOCID de la fiche (`merge-articles`, import CANEVA).
 *
 * La PR #362 tranche : l'identité est le docId de la fiche, partout. Mais elle
 * ne DÉPLACE pas les documents existants. Le jour du deploy, la garde « stock
 * insuffisant » (`identifiantsGardeStock`) ira lire `magasin_F2_IMP-019`
 * pendant que les 9 754 kg de nitrate de potasse dorment toujours dans
 * `magasin_F2_NITRETE_DE_POTASSE`. Elle lira 0, et refusera la sortie. Du stock
 * réel, invisible, sur les plus gros volumes de F2.
 *
 * Ce module planifie le déplacement de chaque solde vers son identifiant
 * canonique. Il n'écrit RIEN et ne connaît pas Firestore : l'écriture, son
 * double verrou, sa sauvegarde et son journal d'audit vivent dans
 * `scripts/recle-soldes-sous-fiche.js`.
 *
 * ── UNE SEULE RÈGLE D'IDENTITÉ ────────────────────────────────────────────
 * `identiteArticle.resoudreIdentite` (bâtie sur `canon`), et elle seule. C'est
 * exactement la règle que la saisie appliquera après #362 : si la re-clé
 * rangeait les soldes autrement que la saisie ne les cherchera, elle ne
 * réparerait rien. Ce module n'a donc AUCUNE normalisation à lui.
 * Idem pour la formule de clé : `identiteArticle.identifiantSoldeCanonique`.
 *
 * ── QUATRE ISSUES, ET QUATRE SEULEMENT ────────────────────────────────────
 *   1. `deja_canonique` — le document est déjà à sa place. On n'y touche pas.
 *   2. `deplacement`    — la cible n'existe pas : on recrée le document à
 *      l'identifiant canonique, avec `article_ref` = docId de fiche, puis on
 *      supprime la source. Le solde est CONSERVÉ à l'unité près.
 *   3. `reunion`        — la cible existe déjà (ou plusieurs sources visent la
 *      même cible) : re-clé et réunion de fragments sont le MÊME problème. On
 *      SOMME. L'exécution est déléguée à `scripts/reunir-soldes-fragmentes.js`
 *      (`reunirUnCas`), qui porte déjà la transaction, la relecture
 *      anti-concurrence et le journal `stock_balance_reunions`.
 *   4. `orphelin`       — le libellé ne résout à AUCUNE fiche (ou en désigne
 *      deux). Il n'a pas de cible : on le LAISSE EN PLACE, on le liste, on ne
 *      le supprime JAMAIS. Supprimer un solde orphelin, c'est effacer du stock
 *      réel que plus aucune fiche ne réclame — un chantier à part, arbitré.
 *
 * ── FAIL-CLOSED SUR LES UNITÉS ────────────────────────────────────────────
 * Deux documents à réunir dont les unités divergent (l vs kg) ne se somment
 * JAMAIS : additionner des litres à des kilos fabrique un chiffre faux, plus
 * difficile à détecter que deux lignes. Ces cas sortent du lot, sont listés, et
 * ne sont pas exécutés. La règle est la MÊME que celle de
 * `reunionSoldes.planifierReunion` — un test d'accord croisé le vérifie, pour
 * que les deux ne puissent pas diverger en silence.
 *
 * Module PUR : aucun accès Firestore, aucun effet de bord.
 */

const identite = require('./identiteArticle');
const reunionSoldes = require('../stockMerge/reunionSoldes');

/** Le document est déjà rangé sous l'identifiant canonique. */
const ISSUE_DEJA_CANONIQUE = 'deja_canonique';
/** La cible n'existe pas : simple déplacement, solde inchangé. */
const ISSUE_DEPLACEMENT = 'deplacement';
/** La cible existe : réunion de fragments, les soldes se SOMMENT. */
const ISSUE_REUNION = 'reunion';
/** Aucune fiche cible : le document reste en place, intact. */
const ISSUE_ORPHELIN = 'orphelin';

/**
 * @typedef {Object} SoldeBrut
 * @property {string} docId
 * @property {*} [article_ref] @property {*} [article_nom]
 * @property {*} [lieu_type] @property {*} [lieu_id]
 * @property {*} [balance] @property {*} [unite]
 */

/**
 * @typedef {Object} CasRecle
 * Volontairement compatible avec le `CasFragmente` de `reunionSoldes` : les cas
 * `reunion` sont passés tels quels à `reunirUnCas`.
 * @property {string} issue Une des quatre constantes ci-dessus.
 * @property {string} article_id docId de la fiche ('' si orphelin).
 * @property {string} article_nom Libellé de la fiche ('' si orphelin).
 * @property {string} lieu_type @property {string} lieu_id
 * @property {SoldeBrut[]} docs Documents concernés, triés par docId.
 * @property {number} total Somme des soldes, au centième.
 * @property {string} conserve docId CONSERVÉ = l'identifiant canonique.
 * @property {string[]} supprimes docIds absorbés/vidés.
 * @property {string[]} anomalies Motifs de blocage (vide = exécutable).
 * @property {string} motif Explication en français, pour le rapport.
 */

/** @param {number} n @returns {number} */
function centime(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Unité comparable (casse et espaces neutralisés). Vide = inconnue, jamais une
 * anomalie : beaucoup de soldes anciens n'en portent pas.
 * @param {*} u @returns {string}
 */
function uniteComparable(u) {
  return u == null ? '' : String(u).trim().toLowerCase();
}

/**
 * Motifs de refus fail-closed d'une réunion. Liste VIDE = exécutable.
 *
 * ⚠️ Ne jamais transformer ce refus en avertissement : le cas serait alors
 * sommé, et le chiffre faux passerait pour un chiffre réparé.
 * @param {SoldeBrut[]} docs @returns {string[]}
 */
function anomaliesUnites(docs) {
  const unites = new Set(
    (Array.isArray(docs) ? docs : []).map((d) => uniteComparable(d && d.unite)).filter((u) => u !== '')
  );
  if (unites.size <= 1) return [];
  return [
    'unités divergentes (' + Array.from(unites).sort().join(' / ') +
      ') — sommer reviendrait à additionner des grandeurs différentes',
  ];
}

/**
 * Document à écrire à l'identifiant canonique lors d'un DÉPLACEMENT.
 *
 * `article_ref` devient le docId de la fiche — c'est tout l'objet de la re-clé.
 * `article_nom` garde le libellé lu, qui reste ce que le magasinier voit ; à
 * défaut seulement, le nom de la fiche. `balance` et `unite` sont RECOPIÉS tels
 * quels : un déplacement ne recalcule rien.
 *
 * @param {SoldeBrut} source
 * @param {{ficheId: string, nom: string}} fiche
 * @returns {{lieu_type: string, lieu_id: string, article_ref: string,
 *            article_nom: string, unite: string, balance: number}}
 */
function documentCible(source, fiche) {
  const s = source || {};
  const nomSaisi = s.article_nom == null ? '' : String(s.article_nom).trim();
  const refSaisie = s.article_ref == null ? '' : String(s.article_ref).trim();
  return {
    lieu_type: s.lieu_type == null ? '' : String(s.lieu_type),
    lieu_id: s.lieu_id == null ? '' : String(s.lieu_id),
    article_ref: String(fiche.ficheId),
    article_nom: nomSaisi || refSaisie || String(fiche.nom || ''),
    unite: s.unite == null ? '' : String(s.unite),
    balance: centime(Number(s.balance) || 0),
  };
}

/**
 * Planifie la re-clé de TOUS les soldes.
 *
 * @param {SoldeBrut[]} soldes TOUS les documents `stock_balances`.
 * @param {Array<Object>} fiches TOUT le catalogue `articles_catalog`.
 * @returns {{cas: CasRecle[], deplacements: CasRecle[], reunions: CasRecle[],
 *            bloques: CasRecle[], orphelins: CasRecle[], deja_canoniques: CasRecle[],
 *            total_documents: number}}
 */
function planifierRecle(soldes, fiches) {
  const idx = identite.indexerFiches(fiches);
  const liste = Array.isArray(soldes) ? soldes : [];

  /** @type {Map<string, {ficheId: string, nom: string, lieu_type: string, lieu_id: string, docs: SoldeBrut[]}>} */
  const parCible = new Map();
  /** @type {CasRecle[]} */
  const orphelins = [];

  for (const s of liste) {
    if (!s || !s.docId) continue;
    const lieuType = s.lieu_type == null ? '' : String(s.lieu_type);
    const lieuId = s.lieu_id == null ? '' : String(s.lieu_id);
    const r = identite.resoudreIdentite(s.article_ref, idx);
    if (r.issue !== identite.ISSUE_RESOLU) {
      // PAS de cible : laissé INTACT, jamais supprimé.
      orphelins.push({
        issue: ISSUE_ORPHELIN,
        article_id: '',
        article_nom: '',
        lieu_type: lieuType,
        lieu_id: lieuId,
        docs: [s],
        total: centime(Number(s.balance) || 0),
        conserve: String(s.docId),
        supprimes: [],
        anomalies: [r.erreur],
        motif: 'laissé en place — ' + r.erreur,
      });
      continue;
    }
    const cible = identite.identifiantSoldeCanonique(lieuType, lieuId, r.ficheId);
    if (!parCible.has(cible)) {
      parCible.set(cible, { ficheId: r.ficheId, nom: r.nom, lieu_type: lieuType, lieu_id: lieuId, docs: [] });
    }
    parCible.get(cible).docs.push(s);
  }

  /** @type {CasRecle[]} */
  const cas = [];
  for (const [cible, g] of parCible.entries()) {
    const docs = g.docs.slice().sort((a, b) => String(a.docId).localeCompare(String(b.docId)));
    const total = centime(docs.reduce((n, d) => n + (Number(d.balance) || 0), 0));
    const dejaLa = docs.some((d) => String(d.docId) === cible);

    if (docs.length === 1 && dejaLa) {
      // Rien à faire — mais on le compte, c'est la part déjà saine.
      cas.push({
        issue: ISSUE_DEJA_CANONIQUE,
        article_id: g.ficheId,
        article_nom: g.nom,
        lieu_type: g.lieu_type,
        lieu_id: g.lieu_id,
        docs,
        total,
        conserve: cible,
        supprimes: [],
        anomalies: [],
        motif: 'déjà rangé sous la fiche',
      });
      continue;
    }

    const supprimes = docs.map((d) => String(d.docId)).filter((id) => id !== cible);
    if (docs.length === 1) {
      cas.push({
        issue: ISSUE_DEPLACEMENT,
        article_id: g.ficheId,
        article_nom: g.nom,
        lieu_type: g.lieu_type,
        lieu_id: g.lieu_id,
        docs,
        total,
        conserve: cible,
        supprimes,
        anomalies: [],
        motif: 'déplacé de « ' + docs[0].docId + ' » vers « ' + cible + ' » — solde inchangé',
      });
      continue;
    }

    // Plusieurs documents visent la même fiche au même lieu : c'est une
    // RÉUNION. On somme (jamais « on garde le plus gros »), sauf unités
    // divergentes — fail-closed.
    cas.push({
      issue: ISSUE_REUNION,
      article_id: g.ficheId,
      article_nom: g.nom,
      lieu_type: g.lieu_type,
      lieu_id: g.lieu_id,
      docs,
      total,
      conserve: cible,
      supprimes,
      anomalies: anomaliesUnites(docs),
      motif:
        docs.length + ' documents réunis sous « ' + cible + ' » — somme ' + total +
        (dejaLa ? '' : ' (la cible n\'existe pas encore, elle est créée)'),
    });
  }

  cas.sort((a, b) =>
    (a.article_nom + '|' + a.lieu_type + '|' + a.lieu_id).localeCompare(
      b.article_nom + '|' + b.lieu_type + '|' + b.lieu_id,
      'fr'
    )
  );
  orphelins.sort((a, b) => String(a.docs[0].docId).localeCompare(String(b.docs[0].docId)));

  return {
    cas: cas.concat(orphelins),
    deplacements: cas.filter((c) => c.issue === ISSUE_DEPLACEMENT),
    reunions: cas.filter((c) => c.issue === ISSUE_REUNION && c.anomalies.length === 0),
    bloques: cas.filter((c) => c.issue === ISSUE_REUNION && c.anomalies.length > 0),
    orphelins,
    deja_canoniques: cas.filter((c) => c.issue === ISSUE_DEJA_CANONIQUE),
    total_documents: liste.filter((s) => s && s.docId).length,
  };
}

/**
 * Incrément à appliquer au document conservé lors d'une réunion : la SOMME des
 * fragments absorbés. Relatif, jamais absolu — une validation de mouvement
 * concurrente sur le document conservé ne doit pas être écrasée.
 * Délégué à `reunionSoldes`, source unique de cette règle.
 * @param {CasRecle} c @returns {number}
 */
function incrementConserve(c) {
  return reunionSoldes.incrementConserve(c);
}

module.exports = {
  ISSUE_DEJA_CANONIQUE,
  ISSUE_DEPLACEMENT,
  ISSUE_REUNION,
  ISSUE_ORPHELIN,
  uniteComparable,
  anomaliesUnites,
  documentCible,
  planifierRecle,
  incrementConserve,
}
