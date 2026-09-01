'use strict';

// @ts-check

/**
 * correctionUniteAcide.js — PLAN de la correction d'unité d'un acide.
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
 * D'où {@link FACTEUR_KG_PAR_LITRE} = 35 / 20 = 1,75 kg par litre. Ce nombre
 * est une DÉCISION : il est nommé, isolé, et recopié dans le journal d'audit
 * pour que personne n'ait à deviner d'où il sort dans six mois.
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
 * Kilos par litre pour les acides. DÉCISION D'OMAR (35 kg = 20 L), pas une
 * mesure physique et pas une constante de calcul générique : ne pas réutiliser
 * ailleurs sans un arbitrage explicite.
 */
const FACTEUR_KG_PAR_LITRE = 35 / 20;

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
 * Convertit un solde exprimé en litres vers des kilos.
 * @param {*} litres @returns {number} kilos, au centième.
 */
function litresEnKilos(litres) {
  return centime((Number(litres) || 0) * FACTEUR_KG_PAR_LITRE);
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

  const fiche = fiches.find((f) => f && String(f.id) === String(p.ficheId)) || null;
  if (!fiche) {
    return { ok: false, refus: ['fiche ' + p.ficheId + ' introuvable au catalogue'], fiche: null, conversions: [], inchanges: [], facteur: FACTEUR_KG_PAR_LITRE };
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
      balance_apres: litresEnKilos(s.balance),
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
    facteur: FACTEUR_KG_PAR_LITRE,
  };
}

module.exports = {
  FACTEUR_KG_PAR_LITRE,
  UNITE_CIBLE,
  litresEnKilos,
  verifierRenommage,
  planifierCorrection,
}
