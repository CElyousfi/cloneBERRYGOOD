'use strict';

// @ts-check

/**
 * correctionUniteStock.js — PLAN d'une correction d'unité de stock.
 *
 * (Nommé `correctionUniteAcide` jusqu'au 2026-09-02 : le premier cas traité
 * était l'acide sulfurique. Les journaux d'audit du 2026-09-01 portent donc
 * `scripts/corriger-unite-acide.js` en `source` — c'est bien ce fichier.)
 *
 * ── LA DÉCISION, ET ELLE EST HUMAINE ──────────────────────────────────────
 * `ACIDE SULFRIQUE @ magasin/F2` porte deux soldes d'unités INCOMPATIBLES :
 *   magasin_F2_ACIDE_SULFRIQUE       « ACIDE SULFRIQUE »      = 3 420 kg
 *   magasin_F2_ACIDE_SULFRIQUE_(L)   « ACIDE SULFRIQUE (L) »  =    −8 l
 * La re-clé (`scripts/recle-soldes-sous-fiche.js`) refuse ce cas — et elle a
 * raison : sommer des litres et des kilos fabriquerait un chiffre faux, plus
 * difficile à détecter que deux lignes. Son fail-closed n'est pas un obstacle
 * à contourner, c'est la garantie qui rend la re-clé sûre. On ne le désarme
 * pas : on retire la divergence EN AMONT.
 *
 * ⚠️ ARBITRAGE D'OMAR, pas une déduction du code — les données ne peuvent pas
 * trancher entre litres et kilos :
 *   « pour les acides, on doit corriger l'unité de réception au Kg et corriger
 *     ces fiches », table de conversion : 35 kg = 20 L.
 * D'où 35 / 20 = 1,75 kg par litre pour l'acide sulfurique. Chaque facteur est
 * une DÉCISION, propre à UN article : il vit dans
 * {@link CONVERSIONS_ARBITREES}, sous sa forme d'origine, et il est recopié
 * dans le journal d'audit avec la phrase qui l'a décidé — pour que personne
 * n'ait à deviner d'où il sort dans six mois. Une fiche hors de la table est
 * REFUSÉE : l'outil ne décide jamais à la place d'un humain.
 *
 * ── POURQUOI CORRIGER LA FICHE, ET PAS SEULEMENT LE SOLDE ─────────────────
 * La fiche `IMP-001` est en `unite: "L"`. Corriger les deux soldes sans elle,
 * c'est écoper : la prochaine réception d'acide réécrirait un solde en litres
 * à côté, et le défaut se rouvrirait. Corriger la fiche tarit la source.
 *
 * ── LE RENOMMAGE EST SÛR, ET C'EST VÉRIFIÉ, PAS SUPPOSÉ ───────────────────
 * `« ACIDE SULFRIQUE (L) »` → `« ACIDE SULFRIQUE »` : `canon` retire le
 * suffixe d'unité, les deux libellés tombent donc dans le MÊME seau
 * d'identité. Le renommage ne peut pas déplacer l'identité de la fiche.
 * {@link verifierRenommage} le REFUSE si ce n'était pas le cas, ou si une
 * autre fiche active portait déjà cette identité (on fabriquerait une
 * ambiguïté, et `resoudreIdentite` refuserait alors toute saisie sur l'article).
 *
 * Module PUR : aucun accès Firestore, aucun effet de bord.
 */

const { canon } = require('./articleKey');
const identite = require('./identiteArticle');

/**
 * TABLE DES CONVERSIONS ARBITRÉES, article par article.
 *
 * ⚠️ Chaque entrée est une DÉCISION D'OMAR, pas une densité physique et pas une
 * constante de calcul. Un facteur ne s'invente pas et ne se généralise pas d'un
 * article à l'autre : `20 kg = 18 L` pour la Rhizo amine ne dit rien de l'acide
 * sulfurique, dont la table est `35 kg = 20 L`.
 *
 * Le facteur est stocké sous sa forme d'origine (`kg` et `litres`) et non
 * calculé, pour que la table d'Omar reste lisible telle qu'il l'a donnée et que
 * le SENS ne puisse pas s'inverser en silence : `20 kg = 18 L` signifie qu'un
 * litre pèse 1,111 kg — PLUS qu'un kilo. Prendre 18/20 au lieu de 20/18 ferait
 * 23,5 % d'écart, sans la moindre alerte.
 *
 * ⛔ AUCUN facteur par défaut : une fiche absente de cette table est REFUSÉE.
 * C'est ce qui empêche l'outil de « décider » à la place d'un humain.
 *
 * @type {Object<string, {kg: number, litres: number, decision: string}>}
 */
const CONVERSIONS_ARBITREES = {
  'IMP-001': {
    kg: 35,
    litres: 20,
    decision:
      'Arbitrage Omar (2026-09-01) : pour les acides, le kg fait foi — ' +
      'table de conversion 35 kg = 20 L.',
  },
  'Ref-Eng0056': {
    kg: 20,
    litres: 18,
    decision:
      'Arbitrage Omar (2026-09-02) : Rhizo amine se tient en kg — ' +
      'table de conversion 20 kg = 18 L.',
  },
};

/**
 * Conversion arbitrée pour une fiche, ou `null` si aucune ne l'a été.
 * @param {*} ficheId
 * @returns {({facteur: number, kg: number, litres: number, decision: string}|null)}
 */
function conversionArbitree(ficheId) {
  const e = CONVERSIONS_ARBITREES[String(ficheId)];
  if (!e) return null;
  return { facteur: e.kg / e.litres, kg: e.kg, litres: e.litres, decision: e.decision };
}

/** Unité qui fait foi pour les acides — décision d'Omar. */
const UNITE_CIBLE = 'kg';

/**
 * @typedef {Object} SoldeBrut
 * @property {string} docId
 * @property {*} [article_ref] @property {*} [article_nom]
 * @property {*} [lieu_type] @property {*} [lieu_id]
 * @property {*} [balance] @property {*} [unite]
 */

/** @param {number} n @returns {number} */
function centime(n) {
  return Math.round(n * 100) / 100;
}

/** @param {*} u @returns {string} */
function uniteComparable(u) {
  return u == null ? '' : String(u).trim().toLowerCase();
}

/**
 * Convertit un solde exprimé en litres vers des kilos, avec le facteur ARBITRÉ
 * de l'article. Le facteur est passé explicitement : aucune valeur par défaut,
 * pour qu'un appel qui l'oublie ne convertisse pas au hasard.
 * @param {*} litres @param {number} facteur kg par litre.
 * @returns {number} kilos, au centième.
 */
function litresEnKilos(litres, facteur) {
  const f = Number(facteur);
  if (!Number.isFinite(f) || f <= 0) throw new Error('facteur de conversion absent ou invalide');
  return centime((Number(litres) || 0) * f);
}

/**
 * Le renommage de la fiche est-il SÛR ?
 *
 * Deux refus, et deux seulement :
 *   - le nouveau nom ne partage pas l'identité canonique de l'ancien : le
 *     renommage déplacerait l'identité de la fiche, donc son stock ;
 *   - une AUTRE fiche active porte déjà cette identité : on fabriquerait une
 *     ambiguïté, et `resoudreIdentite` refuserait ensuite toute saisie sur
 *     l'article — le magasinier serait enfermé.
 *
 * @param {string} ficheId
 * @param {*} ancienNom @param {*} nouveauNom
 * @param {Array<Object>} fiches TOUT le catalogue.
 * @returns {{ok: boolean, motif: string}}
 */
function verifierRenommage(ficheId, ancienNom, nouveauNom, fiches) {
  const avant = canon(ancienNom);
  const apres = canon(nouveauNom);
  if (!apres) return { ok: false, motif: 'le nouveau nom est vide' };
  if (avant !== apres) {
    return {
      ok: false,
      motif:
        'le renommage déplacerait l\'identité de la fiche : canon(« ' + ancienNom +
        ' ») = « ' + avant + ' » mais canon(« ' + nouveauNom + ' ») = « ' + apres + ' »',
    };
  }
  const idx = identite.indexerFiches(fiches);
  const homonymes = (idx.parCanon.get(apres) || []).filter((f) => String(f.id) !== String(ficheId));
  if (homonymes.length) {
    return {
      ok: false,
      motif:
        'une autre fiche active porte déjà cette identité : ' +
        homonymes.map((f) => '« ' + f.nom + ' » (' + f.id + ')').join(', ') +
        ' — le renommage fabriquerait une ambiguïté et bloquerait la saisie',
    };
  }
  return { ok: true, motif: '' };
}

/**
 * @typedef {Object} PlanCorrection
 * @property {boolean} ok Exécutable.
 * @property {string[]} refus Motifs de blocage (vide si `ok`).
 * @property {(Object|null)} fiche `{id, nom_avant, nom_apres, unite_avant, unite_apres}`.
 * @property {Array<Object>} conversions Soldes à convertir.
 * @property {Array<Object>} inchanges Soldes déjà dans l'unité cible.
 * @property {number} facteur Le facteur de conversion retenu.
 */

/**
 * Planifie la correction : la fiche, puis les soldes du lieu qui ne sont PAS
 * déjà dans l'unité cible.
 *
 * FAIL-CLOSED : refuse si la fiche est absente, si le renommage est risqué, ou
 * si un solde porte une unité qui n'est ni l'unité cible ni le litre — on ne
 * convertit que ce dont Omar a donné le facteur.
 *
 * @param {Object} params
 * @param {string} params.ficheId
 * @param {string} params.nouveauNom
 * @param {SoldeBrut[]} params.soldes Soldes concernés (déjà filtrés par l'appelant).
 * @param {Array<Object>} params.fiches TOUT le catalogue.
 * @returns {PlanCorrection}
 */
function planifierCorrection(params) {
  const p = params || {};
  const fiches = Array.isArray(p.fiches) ? p.fiches : [];
  const soldes = Array.isArray(p.soldes) ? p.soldes : [];
  /** @type {string[]} */
  const refus = [];

  const conv = conversionArbitree(p.ficheId);
  const fiche = fiches.find((f) => f && String(f.id) === String(p.ficheId)) || null;
  if (!fiche) {
    return { ok: false, refus: ['fiche ' + p.ficheId + ' introuvable au catalogue'], fiche: null, conversions: [], inchanges: [], facteur: 0, decision: '' };
  }
  if (!conv) {
    return {
      ok: false,
      refus: [
        'aucune conversion n\'a été arbitrée pour la fiche ' + p.ficheId +
          ' — un facteur ne s\'invente pas, il se demande à Omar',
      ],
      fiche: null,
      conversions: [],
      inchanges: [],
      facteur: 0,
      decision: '',
    };
  }

  const v = verifierRenommage(p.ficheId, fiche.nom, p.nouveauNom, fiches);
  if (!v.ok) refus.push(v.motif);

  /** @type {Array<Object>} */
  const conversions = [];
  /** @type {Array<Object>} */
  const inchanges = [];
  for (const s of soldes) {
    if (!s || !s.docId) continue;
    const u = uniteComparable(s.unite);
    if (u === UNITE_CIBLE) {
      inchanges.push({ docId: String(s.docId), balance: centime(Number(s.balance) || 0), unite: u });
      continue;
    }
    if (u !== 'l') {
      refus.push(
        'le solde ' + s.docId + ' porte l\'unité « ' + String(s.unite) +
          ' » : aucun facteur de conversion n\'a été arbitré pour elle'
      );
      continue;
    }
    conversions.push({
      docId: String(s.docId),
      balance_avant: centime(Number(s.balance) || 0),
      unite_avant: u,
      balance_apres: litresEnKilos(s.balance, conv.facteur),
      unite_apres: UNITE_CIBLE,
    });
  }

  return {
    ok: refus.length === 0,
    refus,
    fiche: {
      id: String(fiche.id),
      nom_avant: fiche.nom == null ? '' : String(fiche.nom),
      nom_apres: String(p.nouveauNom),
      unite_avant: fiche.unite == null ? '' : String(fiche.unite),
      unite_apres: UNITE_CIBLE,
    },
    conversions,
    inchanges,
    facteur: conv.facteur,
    decision: conv.decision,
  };
}

module.exports = {
  CONVERSIONS_ARBITREES,
  conversionArbitree,
  UNITE_CIBLE,
  litresEnKilos,
  verifierRenommage,
  planifierCorrection,
}
