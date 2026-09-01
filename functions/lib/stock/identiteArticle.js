'use strict';

// @ts-check

/**
 * identiteArticle.js — SOURCE UNIQUE de l'IDENTITÉ d'un article de stock.
 *
 * ── LE DÉFAUT QU'IL FERME ─────────────────────────────────────────────────
 * L'identité du stock est `article_ref`, et rien d'autre : c'est lui seul qui
 * forme l'identifiant du document `stock_balances`
 * (`${lieu_type}_${lieu_id}_${article_ref}`). Or SEPT producteurs y écrivaient
 * DEUX conventions incompatibles :
 *   - le LIBELLÉ tapé par le magasinier (`create-bc`, `create-bl`,
 *     `create-movement`, les deux `reverse`) ;
 *   - le DOCID de la fiche (`merge-articles`, import CANEVA).
 * Résultat : deux documents de solde pour le même article au même lieu.
 * 47 cas mesurés en production le 2026-08-31, contre 29 la veille — ce n'est
 * pas un stock d'erreurs à écouler, c'est une production continue.
 *
 * ── LA RÈGLE, DÉSORMAIS UNIQUE ────────────────────────────────────────────
 * L'identité d'une ligne de stock est le DOCID DE LA FICHE ACTIVE du
 * catalogue. Le libellé saisi reste dans `article_nom` — c'est ce que le
 * magasinier lit — mais il n'est plus JAMAIS une identité.
 *
 * ── POURQUOI `canon` ET PAS `normalizeArticleName` ────────────────────────
 * Mesuré sur la production le 2026-08-31 (scripts de mesure rejoués deux fois) :
 *   - 1 019 fiches actives : `canon` produit **0 collision**, `normalizeArticleName`
 *     aussi. `canon` n'est donc pas plus risquée ;
 *   - sur les 199 libellés réellement présents dans `stock_movements` :
 *     185 rattachés par les deux, **9 par `canon` seule** (1 098 lignes de
 *     mouvement), **0 par `normalizeArticleName` seule**.
 *     Les 9 sont exactement les libellés à suffixe d'unité, que `canon` seule
 *     retire : `RHIZO MN ZN` → `RHIZO MN ZN (KG)` (308 lignes), `KSC 3` →
 *     `KSC 3 (KG)` (281), `DEPTIL PA5` → `DEPTIL PA5 (L)` (231),
 *     `ACIDE SULFRIQUE` → `ACIDE SULFRIQUE (L)` (105), `OPAL` (61),
 *     `APPOLO` (44), `AZO PRO 31` (43), `ACRAMET` (16), `BIOACTYL SUPERBE` (9).
 * Choisir `normalizeArticleName` fabriquerait donc 9 refus fail-closed sur des
 * articles qui EXISTENT au catalogue. `canon` est la normalisation d'identité.
 *
 * ── LES 5 LIBELLÉS QUI NE SE RATTACHENT À RIEN ────────────────────────────
 * `TES` (6 lignes), `GENAKTIS` (2), `SEACTIV GENAKTIS 3` (1), `M.K.P` (1),
 * `Maspilan` (1) — 11 lignes sur 4 516. Ce sont les futurs refus fail-closed
 * à la saisie : l'article doit d'abord être créé au catalogue.
 *
 * Module PUR : aucun accès Firestore, aucun effet de bord.
 */

const { canon } = require('./articleKey');

/** Issue : la fiche active est identifiée sans ambiguïté. */
const ISSUE_RESOLU = 'resolu';
/** Issue : aucune fiche active ne porte cette identité. */
const ISSUE_INTROUVABLE = 'introuvable';
/** Issue : DEUX fiches actives portent la même identité — indécidable. */
const ISSUE_AMBIGU = 'ambigu';

/** Nombre maximal de sauts suivis dans une chaîne `merged_into`. */
const MAX_SAUTS_FUSION = 5;

/**
 * @typedef {Object} FicheArticle
 * @property {string} id docId au catalogue.
 * @property {*} [nom]
 * @property {*} [active]
 * @property {*} [merged_into]
 * @property {*} [unite]
 */

/**
 * @typedef {Object} IndexIdentite
 * @property {Map<string, FicheArticle>} parId TOUTES les fiches, actives ou non
 *   (indispensable pour suivre une chaîne `merged_into` qui traverse des fiches
 *   désactivées par une fusion).
 * @property {Map<string, FicheArticle[]>} parCanon `canon(nom)` -> fiches ACTIVES.
 *   Une LISTE, jamais une seule fiche : c'est ce qui permet de DÉTECTER
 *   l'ambiguïté au lieu de la masquer derrière un « le plus petit docId gagne ».
 */

/**
 * @typedef {Object} Resolution
 * @property {string} issue `ISSUE_RESOLU` | `ISSUE_INTROUVABLE` | `ISSUE_AMBIGU`.
 * @property {string} ficheId docId de la fiche active ('' si non résolu).
 * @property {string} nom Libellé de la fiche active ('' si non résolu).
 * @property {string} libelle Libellé interrogé, tel que reçu.
 * @property {FicheArticle[]} candidats Fiches en cause si `ISSUE_AMBIGU`.
 * @property {string} erreur Phrase française nommant l'article ('' si résolu).
 */

/**
 * Construit l'index de résolution d'identité, en UN passage sur le catalogue.
 *
 * @param {Array<FicheArticle>} fiches TOUT le catalogue (actif ou non).
 * @returns {IndexIdentite}
 */
function indexerFiches(fiches) {
  /** @type {Map<string, FicheArticle>} */
  const parId = new Map();
  /** @type {Map<string, FicheArticle[]>} */
  const parCanon = new Map();
  for (const f of Array.isArray(fiches) ? fiches : []) {
    if (!f || !f.id) continue;
    parId.set(String(f.id), f);
  }
  for (const f of parId.values()) {
    if (f.active === false) continue;
    if (f.merged_into) continue;
    const k = canon(f.nom);
    if (!k) continue;
    if (!parCanon.has(k)) parCanon.set(k, []);
    parCanon.get(k).push(f);
  }
  // Ordre déterministe : deux appels successifs nomment les mêmes fiches dans
  // le même ordre, y compris dans le message d'ambiguïté.
  for (const liste of parCanon.values()) {
    liste.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return { parId, parCanon };
}

/**
 * Une fiche est-elle VIVANTE (utilisable comme identité) ?
 * Garde POSITIVE, comme `articleMerge.verifierIntegriteFiche` : on refuse tout
 * ce qui n'est pas explicitement une fiche active nommée. Les 5 documents
 * FANTÔMES de production (sans `nom` ni `active`) ne peuvent donc pas devenir
 * l'identité d'un solde.
 * @param {(FicheArticle|null|undefined)} f
 * @returns {boolean}
 */
function ficheVivante(f) {
  if (!f || !f.id) return false;
  if (f.active === false) return false;
  if (f.merged_into) return false;
  return !!canon(f.nom);
}

/**
 * Résout un libellé OU une référence vers le docId d'une fiche ACTIVE.
 *
 * Cascade — la MÊME que `reunionSoldes.ficheDuSolde`, à la normalisation près
 * (`canon` au lieu de `normalizeArticleName`, cf. en-tête) :
 *   1. docId exact d'une fiche vivante ;
 *   2. `canon(libellé)` parmi les fiches actives — 1 candidat = résolu,
 *      2+ = AMBIGU (jamais « le premier gagne » : une identité indécidable
 *      doit se voir, pas se choisir au hasard) ;
 *   3. fiche connue mais fusionnée : on suit la chaîne `merged_into`, bornée à
 *      {@link MAX_SAUTS_FUSION} sauts. C'est ce qui fait qu'un article fusionné
 *      écrit dans le solde de son MAÎTRE, au lieu d'en créer un second à côté ;
 *   4. sinon INTROUVABLE.
 *
 * @param {*} libelle Libellé saisi, ou référence/docId.
 * @param {IndexIdentite} idx
 * @returns {Resolution}
 */
function resoudreIdentite(libelle, idx) {
  const brut = libelle == null ? '' : String(libelle).trim();
  const parId = idx && idx.parId instanceof Map ? idx.parId : new Map();
  const parCanon = idx && idx.parCanon instanceof Map ? idx.parCanon : new Map();

  /** @param {FicheArticle} f @returns {Resolution} */
  const resolu = (f) => ({
    issue: ISSUE_RESOLU,
    ficheId: String(f.id),
    nom: f.nom == null ? '' : String(f.nom),
    libelle: brut,
    candidats: [],
    erreur: '',
  });

  if (!brut) {
    return {
      issue: ISSUE_INTROUVABLE,
      ficheId: '',
      nom: '',
      libelle: '',
      candidats: [],
      erreur: 'Une ligne du bon n\'a pas d\'article : impossible de savoir quel stock mouvementer.',
    };
  }

  // 1. docId exact
  const parIdHit = parId.get(brut);
  if (ficheVivante(parIdHit)) return resolu(/** @type {FicheArticle} */ (parIdHit));

  // 2. identité canonique
  const cle = canon(brut);
  const candidats = (cle && parCanon.get(cle)) || [];
  if (candidats.length === 1) return resolu(candidats[0]);
  if (candidats.length > 1) {
    const noms = candidats
      .map((c) => '« ' + String(c.nom == null ? '' : c.nom) + ' » (' + String(c.id) + ')')
      .join(' et ');
    return {
      issue: ISSUE_AMBIGU,
      ficheId: '',
      nom: '',
      libelle: brut,
      candidats: candidats.slice(),
      erreur:
        'L\'article « ' + brut + ' » correspond à ' + candidats.length +
        ' fiches actives du catalogue : ' + noms +
        '. Fusionnez-les avant de saisir ce bon — le stock ne peut pas être tenu sous deux identités.',
    };
  }

  // 3. chaîne de fusion, bornée
  let courante = parIdHit || null;
  let sauts = 0;
  while (courante && !ficheVivante(courante) && courante.merged_into && sauts < MAX_SAUTS_FUSION) {
    courante = parId.get(String(courante.merged_into)) || null;
    sauts += 1;
  }
  if (ficheVivante(courante)) return resolu(/** @type {FicheArticle} */ (courante));

  // 4. introuvable
  return {
    issue: ISSUE_INTROUVABLE,
    ficheId: '',
    nom: '',
    libelle: brut,
    candidats: [],
    erreur:
      'L\'article « ' + brut + ' » n\'existe pas au catalogue. ' +
      'Créez-le au catalogue avant de saisir ce bon.',
  };
}

/**
 * Libellé porté par une ligne de mouvement, quelle que soit sa provenance.
 * `article_ref` d'abord parce que c'est là que tous les formulaires écrivent
 * aujourd'hui le libellé tapé.
 * @param {*} ligne
 * @returns {string}
 */
function libelleDeLigne(ligne) {
  const l = ligne || {};
  const cands = [l.article_ref, l.article_nom, l.article];
  for (const c of cands) {
    const s = c == null ? '' : String(c).trim();
    if (s) return s;
  }
  return '';
}

/**
 * @typedef {Object} RefusIdentite
 * @property {string} code `article_inconnu` | `article_ambigu`.
 * @property {string} erreur Message français NOMMANT chaque article en cause.
 * @property {Resolution[]} details Résolutions fautives.
 */

/**
 * Résout TOUTES les lignes d'un mouvement — FAIL-CLOSED.
 *
 * ⚠️ DÉCISION D'OMAR, changement de comportement produit assumé : un libellé
 * non résolu (ou ambigu) FAIT ÉCHOUER LE BON, en le nommant. Rien n'entre plus
 * en stock sous une identité inventée — c'est ce qui rend la correction
 * définitive : aucun chemin de saisie ne peut plus fabriquer un solde orphelin.
 * La sortie offerte au magasinier est « Créer cet article au catalogue ».
 *
 * Les lignes rendues portent :
 *   - `article_ref` = le DOCID de la fiche active (l'identité) ;
 *   - `article_nom` = le LIBELLÉ SAISI, inchangé (à défaut, le nom de la fiche).
 * Aucun autre champ n'est touché : la valorisation (`prixLigne.valoriserLignes`)
 * lit `article_nom` en priorité, elle continue donc de voir le libellé.
 *
 * @param {Array<Object>} lignes
 * @param {IndexIdentite} idx
 * @returns {{ok: boolean, lignes: Array<Object>, refus: (RefusIdentite|null)}}
 */
function resoudreLignes(lignes, idx) {
  const liste = Array.isArray(lignes) ? lignes : [];
  /** @type {Array<Object>} */
  const sorties = [];
  /** @type {Resolution[]} */
  const fautives = [];

  for (const ligne of liste) {
    const libelle = libelleDeLigne(ligne);
    const r = resoudreIdentite(libelle, idx);
    if (r.issue !== ISSUE_RESOLU) {
      fautives.push(r);
      continue;
    }
    const nomSaisi = ligne && ligne.article_nom != null ? String(ligne.article_nom).trim() : '';
    sorties.push(
      Object.assign({}, ligne, {
        article_ref: r.ficheId,
        article_nom: nomSaisi || libelle || r.nom,
      })
    );
  }

  if (fautives.length) {
    const ambigu = fautives.some((f) => f.issue === ISSUE_AMBIGU);
    return {
      ok: false,
      lignes: [],
      refus: {
        code: ambigu ? 'article_ambigu' : 'article_inconnu',
        erreur: fautives.map((f) => f.erreur).join(' '),
        details: fautives,
      },
    };
  }
  return { ok: true, lignes: sorties, refus: null };
}

/**
 * Identité de stock d'une ligne de mouvement DÉJÀ ÉCRIT (application ou
 * annulation d'impact).
 *
 * ⚠️ CE N'EST PAS UNE SAISIE, et le contrat n'est donc PAS fail-closed : un
 * libellé qui ne se résout à aucune fiche (11 lignes sur 4 516 en production —
 * `TES`, `GENAKTIS`, `M.K.P`…) conserve sa clé BRUTE. Refuser ici ne
 * protégerait rien — le mouvement existe déjà — et rendrait son annulation
 * IMPOSSIBLE, c'est-à-dire piégerait l'utilisateur.
 *
 * Vit dans le module PUR, et pas dans le monolithe, précisément pour que ce
 * contrat soit vérifiable par un test de COMPORTEMENT : un `return brut`
 * inconditionnel (qui débranche silencieusement le suivi de `merged_into`
 * après une fusion) doit faire rougir la suite, pas passer inaperçu.
 *
 * @param {*} ligne Ligne de mouvement.
 * @param {IndexIdentite} idx
 * @returns {string} docId de fiche si résolu, sinon le libellé brut.
 */
function identiteImpact(ligne, idx) {
  const brut = libelleDeLigne(ligne);
  const r = resoudreIdentite(brut, idx);
  return r.issue === ISSUE_RESOLU ? r.ficheId : brut;
}

/**
 * Identifiant canonique d'un document `stock_balances` — FORMULE HISTORIQUE,
 * inchangée. Ce qui change n'est pas la formule mais ce qu'on lui donne :
 * désormais un docId de fiche RÉSOLU, plus jamais un libellé.
 *
 * Cette fonction est la SEULE occurrence de la formule dans le dépôt :
 * l'écriture (`updateStockBalance`), la garde « stock insuffisant » et la
 * génération/purge de `rebuildBalances` l'appellent toutes. C'est précisément
 * parce que ces trois-là portaient chacune leur copie que la garde a pu
 * interroger un seau vide et laisser sortir du stock inexistant.
 *
 * @param {*} lieuType
 * @param {*} lieuId
 * @param {*} ficheId docId de fiche, DÉJÀ résolu.
 * @returns {string}
 */
function identifiantSoldeCanonique(lieuType, lieuId, ficheId) {
  return `${lieuType}_${lieuId}_${ficheId}`.replace(/\s+/g, '_');
}

/**
 * Identifiants de solde à LIRE pour la garde « stock insuffisant ».
 *
 * ── POURQUOI CETTE FONCTION EXISTE ────────────────────────────────────────
 * C'est le point le plus vicieux du chantier : si la garde lit le solde sous
 * l'ANCIENNE clé (le libellé) pendant que l'écriture le tient sous la
 * NOUVELLE (le docId), elle interroge un document qui n'existe pas, lit 0, et
 * refuse tout — ou pire, dans l'autre sens, laisse sortir du stock qui n'existe
 * pas. Aucune erreur, aucune trace. La clé de lecture est donc dérivée ICI,
 * de la MÊME fonction que la clé d'écriture, à partir des lignes DÉJÀ RÉSOLUES.
 *
 * @param {{type?:*, id?:*}} lieuSource Lieu de départ du mouvement.
 * @param {Array<{article_ref?:*}>} lignesResolues Lignes passées par `resoudreLignes`.
 * @returns {Array<{ficheId: string, balanceId: string}>} sans doublon, ordre d'apparition.
 */
function identifiantsGardeStock(lieuSource, lignesResolues) {
  const lieu = lieuSource || {};
  /** @type {Array<{ficheId: string, balanceId: string}>} */
  const out = [];
  const vus = new Set();
  for (const l of Array.isArray(lignesResolues) ? lignesResolues : []) {
    const ficheId = l && l.article_ref != null ? String(l.article_ref) : '';
    if (!ficheId || vus.has(ficheId)) continue;
    vus.add(ficheId);
    out.push({ ficheId, balanceId: identifiantSoldeCanonique(lieu.type, lieu.id, ficheId) });
  }
  return out;
}

/**
 * @typedef {Object} DeltaSolde
 * @property {*} lieu_type @property {*} lieu_id
 * @property {*} article_ref @property {*} [article_nom] @property {*} [unite]
 * @property {*} delta
 */

/**
 * Agrège des deltas en soldes, en RÉSOLVANT l'identité de chaque ligne.
 *
 * Sert à `rebuildBalances` (import CANEVA), qui rejoue l'inventaire de départ
 * puis TOUT le grand livre. Les 4 516 mouvements gardent leur libellé
 * (décision d'Omar) : c'est donc ici, à la lecture, que le libellé devient une
 * identité.
 *
 * ⚠️ REPLI ASSUMÉ, et il n'est PAS une entorse au fail-closed : un libellé non
 * résolu conserve sa clé BRUTE. `rebuildBalances` n'est pas une saisie, c'est
 * un RECALCUL de l'historique — refuser l'import entier à cause de 11 lignes
 * historiques orphelines (`TES`, `GENAKTIS`, `M.K.P`…) ne réparerait rien et
 * bloquerait tout. Le repli est SÛR parce que la purge, plus bas, travaille sur
 * les clés RÉELLEMENT générées : un solde orphelin est régénéré à l'identique,
 * donc jamais supprimé. Le fail-closed reste entier là où il compte : à la
 * SAISIE (`resoudreLignes`).
 *
 * @param {Array<DeltaSolde>} deltas
 * @param {IndexIdentite} idx
 * @returns {{soldes: Map<string, Object>, non_resolus: string[]}}
 */
function agregerSoldes(deltas, idx) {
  /** @type {Map<string, Object>} */
  const soldes = new Map();
  /** @type {Set<string>} */
  const nonResolus = new Set();
  for (const d of Array.isArray(deltas) ? deltas : []) {
    if (!d) continue;
    const libelle = d.article_ref == null ? '' : String(d.article_ref);
    if (!libelle) continue;
    const r = resoudreIdentite(libelle, idx);
    let ficheId = r.ficheId;
    if (r.issue !== ISSUE_RESOLU) {
      nonResolus.add(libelle);
      ficheId = libelle; // repli documenté ci-dessus
    }
    const k = identifiantSoldeCanonique(d.lieu_type, d.lieu_id, ficheId);
    const cur = soldes.get(k) || {
      lieu_type: d.lieu_type,
      lieu_id: d.lieu_id,
      article_ref: ficheId,
      article_nom: d.article_nom || libelle,
      unite: d.unite || 'kg',
      balance: 0,
    };
    cur.balance = Math.round((cur.balance + (Number(d.delta) || 0)) * 100) / 100;
    if (d.article_nom) cur.article_nom = d.article_nom;
    soldes.set(k, cur);
  }
  return { soldes, non_resolus: Array.from(nonResolus).sort() };
}

/**
 * Documents `stock_balances` à SUPPRIMER après un recalcul.
 *
 * La purge et la génération DOIVENT partager la même règle de clé : sinon un
 * import supprime des soldes qu'il ne sait pas régénérer — c'est déjà arrivé,
 * et c'est ce qui effaçait les soldes rangés sous le nom que la saisie
 * recréait aussitôt à côté de ceux rangés sous la référence.
 * Ici la règle est structurelle, pas recopiée : on purge exactement ce que
 * `agregerSoldes` n'a PAS généré.
 *
 * @param {Map<string, Object>} soldesCalcules Sortie de `agregerSoldes`.
 * @param {Array<string>} docIdsExistants
 * @returns {string[]} docIds à supprimer.
 */
function docsAPurger(soldesCalcules, docIdsExistants) {
  const generes = soldesCalcules instanceof Map ? soldesCalcules : new Map();
  return (Array.isArray(docIdsExistants) ? docIdsExistants : []).filter(
    (id) => !generes.has(String(id))
  );
}

module.exports = {
  ISSUE_RESOLU,
  ISSUE_INTROUVABLE,
  ISSUE_AMBIGU,
  MAX_SAUTS_FUSION,
  indexerFiches,
  resoudreIdentite,
  libelleDeLigne,
  resoudreLignes,
  identiteImpact,
  identifiantSoldeCanonique,
  identifiantsGardeStock,
  agregerSoldes,
  docsAPurger,
}
