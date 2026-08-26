'use strict';
// @ts-check

/**
 * bonsToConsoRows.js — Adaptation PURE des bons de consommation Smart Berry
 * (`consumption_vouchers`) vers la forme de ligne historiquement produite par la
 * collection miroir BEE ONE `sql_mirror_consommation`.
 *
 * CONTEXTE (décision Omar, ticket sb/conso-campagne-bons)
 * -------------------------------------------------------
 * La source BEE ONE est TARIE : `sql_mirror_consommation` ne contient plus rien
 * depuis avril 2026 (10 mois, 2025-07 → 2026-04, 0 ligne sur la campagne
 * courante). La consommation réelle est désormais saisie par le magasinier dans
 * `consumption_vouchers` (action `create-bc`). On tourne la page : les écrans de
 * consommation lisent les BONS SMART BERRY UNIQUEMENT — pas d'union avec BEE
 * ONE, pas de bascule à une date. Conséquence assumée : les campagnes
 * antérieures s'affichent vides sur ces écrans. Les données BEE ONE restent en
 * base (rien n'est supprimé).
 *
 * Ce module ne fait QUE de la transformation : aucune lecture Firestore, toutes
 * les données de contexte entrent par argument (DI), comme
 * functions/lib/irrigation/ et functions/lib/parcelleGroupes/.
 *
 * FORME DE SORTIE (contrat consommé tel quel par les agrégations existantes —
 * `aggregateConsoValorisee`, `aggregateConsoParcelle`) :
 *   { Date, Parcelle_Culturale, Article, Article_Categorie, Quantite,
 *     Article_unite, Culture, Ferme, Parcelle_sup, Bon_Id, Bon_Numero }
 *
 * DÉCISIONS DE MAPPING (chacune vérifiée sur les données réelles, 44 bons /
 * 500 items au 2026-08-26) :
 *
 *  - `Ferme` est DÉRIVÉE DU LIBELLÉ DE PARCELLE, jamais reprise de `item.ferme`.
 *    Mesuré en prod : 212 items sur 500 portent `ferme: "BERRY GOOD Farms"`
 *    (valeur fourre-tout, exactement la même pathologie que le champ `Ferme` du
 *    miroir BEE ONE), les 288 autres portent F1..F5. Un champ à moitié
 *    inexploitable ne peut pas servir de base au cloisonnement : on applique la
 *    règle UNIQUE `fermeDeParcelle` (fermeConso.js), partagée par les deux
 *    écrans de consommation, FAIL-CLOSED (libellé non dérivable → `''`, jamais
 *    rattaché à un chef).
 *
 *  - `Culture` passe par `resolveCulture` : `culture_sb` du référentiel Smart
 *    Berry en priorité, sinon repli heuristique `normCulture` sur `item.culture`
 *    puis sur le libellé de parcelle. Nécessaire : mesuré en prod, `item.culture`
 *    est vide sur 260 items /500 et sale sur le reste (« FRAMBOISE » et
 *    « Framboise », « AVOCATIER » et « Avocatier », « MYRTILLES » au pluriel).
 *    `resolveCulture` canonise en 'Framboise' | 'Myrtille' | 'Avocatier'.
 *
 *  - `Parcelle_Culturale` = `item.parcelle` TEL QUEL. C'est déjà le libellé
 *    RÉEL : `create-bc` éclate les groupes de parcelles au prorata des Ha à
 *    l'écriture (functions/index.js) et ne persiste JAMAIS un libellé de groupe.
 *
 *  - `Article_Categorie` = `bon.cpc_categorie`, qui vaut littéralement
 *    « Engrais » / « Pesticides » — le vocabulaire BEE ONE. Repli sur `bon.type`
 *    ('engrais' → 'Engrais', 'pesticide' → 'Pesticides') si le champ manque.
 *    ⚠️ Les consommateurs doivent classer avec `familleBucket` (tolérant à la
 *    casse), JAMAIS avec une égalité stricte.
 *
 *  - Le rattachement à une CAMPAGNE se fait par la DATE DU BON (`campagneOf`) :
 *    aucun champ campagne n'est persisté sur `consumption_vouchers`. La date
 *    d'un bon est modifiable a posteriori (`update-bc-date`), donc un bon PEUT
 *    changer de campagne — c'est voulu.
 *
 * EXCLUSIONS (une ligne non émise ne doit jamais devenir une ligne à zéro) :
 *  - bon sans `items` exploitable ;
 *  - item sans parcelle (la jointure aval se fait par libellé : sans parcelle,
 *    la ligne n'est rattachable à rien) ;
 *  - item de quantité nulle, négative ou non numérique — même règle que
 *    `create-bc`, qui ne crée un mouvement de stock que pour `quantite > 0`.
 */

const { campagneOf } = require('../mappingConso/campagneUtils');
const { resolveCulture } = require('../campagneExport/cultureUtils');
const { fermeDeParcelle } = require('./fermeConso');

/** Regex stricte d'une date ISO 'YYYY-MM-DD'. */
const __cb_ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Repli `bon.type` → catégorie CPC, quand `cpc_categorie` est absent. */
const __cb_TYPE_TO_CATEGORIE = {
  engrais: 'Engrais',
  pesticide: 'Pesticides',
};

/**
 * Normalise une valeur en chaîne trimée ('' si null/undefined/non-string).
 * @param {*} v
 * @returns {string}
 */
function __cb_str(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * Catégorie CPC d'un bon : `cpc_categorie` prioritaire, repli sur `type`.
 * Retourne '' si rien n'est exploitable (la ligne sera classée « autre » par
 * `familleBucket` en aval — jamais silencieusement rangée dans Engrais).
 *
 * @param {*} bon
 * @returns {string}
 */
function categorieOf(bon) {
  const b = bon || {};
  const cat = __cb_str(b.cpc_categorie);
  if (cat) return cat;
  const type = __cb_str(b.type).toLowerCase();
  return __cb_TYPE_TO_CATEGORIE[type] || '';
}

/**
 * Quantité exploitable d'un item : nombre fini strictement positif, sinon null.
 * Accepte les quantités saisies en CHAÎNE ('12.5').
 *
 * @param {*} v
 * @returns {number|null}
 */
function quantiteOf(v) {
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * @typedef {Object} AdaptOptions
 * @property {Record<string, number>} [haByLabel] Ha par libellé de parcelle
 *   NORMALISÉ (MAJUSCULES + trim), depuis `sb_parcelle_referentiel`.
 * @property {Record<string, {culture_sb?: string}>} [sbMap] référentiel Smart
 *   Berry indexé par libellé normalisé, pour `resolveCulture`.
 * @property {string} [campagne] ne garder que les bons dont `campagneOf(date)`
 *   vaut ce libellé ('2026-2027').
 * @property {string} [since] borne basse inclusive 'YYYY-MM-DD'.
 * @property {string} [until] borne haute inclusive 'YYYY-MM-DD'.
 */

/**
 * Transforme une liste de bons de consommation en lignes de conso (forme
 * miroir). Un item exploitable = une ligne ; l'agrégation par
 * parcelle × article est du ressort de l'appelant.
 *
 * @param {Array<Object>} bons documents `consumption_vouchers`.
 * @param {AdaptOptions} [options]
 * @returns {Array<Object>} lignes de conso.
 */
function adaptBonsToConsoRows(bons, options) {
  const list = Array.isArray(bons) ? bons : [];
  const opts = options || {};
  const haByLabel = opts.haByLabel || {};
  const sbMap = opts.sbMap || {};
  const campagne = __cb_str(opts.campagne);
  const since = __cb_str(opts.since);
  const until = __cb_str(opts.until);

  const rows = [];

  for (const bon of list) {
    if (!bon || typeof bon !== 'object') continue;

    const date = __cb_str(bon.date);
    // Date non ISO → aucune fenêtre temporelle ne peut trancher : on exclut.
    if (!__cb_ISO_DATE_RE.test(date)) continue;
    if (campagne && campagneOf(date) !== campagne) continue;
    if (since && date < since) continue;
    if (until && date > until) continue;

    const categorie = categorieOf(bon);
    const items = Array.isArray(bon.items) ? bon.items : [];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      const parcelle = __cb_str(item.parcelle);
      if (!parcelle) continue;

      const quantite = quantiteOf(item.quantite);
      if (quantite === null) continue;

      const key = parcelle.toUpperCase();
      const ha = parseFloat(String(haByLabel[key]));

      rows.push({
        Date: date,
        Parcelle_Culturale: parcelle,
        Article: __cb_str(item.article),
        Article_Categorie: categorie,
        Quantite: quantite,
        Article_unite: __cb_str(item.unite),
        Culture: resolveCulture({ label: parcelle, culture: item.culture }, sbMap),
        // FAIL-CLOSED : jamais `item.ferme` (fourre-tout « BERRY GOOD Farms »).
        // Règle UNIQUE partagée par les deux écrans — cf. fermeConso.js.
        Ferme: fermeDeParcelle(parcelle) || '',
        Parcelle_sup: isFinite(ha) && ha > 0 ? ha : 0,
        // Traçabilité : ignoré par les agrégations, précieux au débogage.
        Bon_Id: __cb_str(bon.id),
        Bon_Numero: __cb_str(bon.numero),
      });
    }
  }

  return rows;
}

module.exports = {
  adaptBonsToConsoRows,
  categorieOf,
  quantiteOf,
};
