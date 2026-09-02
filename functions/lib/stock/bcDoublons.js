/**
 * bcDoublons.js — Logique PURE de la garde anti-doublon à la création d'un bon
 * de consommation (action `create-bc` de /api/stock).
 *
 * ── LE PROBLÈME, MESURÉ EN PRODUCTION ─────────────────────────────────────
 * Sur 49 bons existants, 2 sont des doublons, et ils sont STRICTEMENT
 * identiques : mêmes articles, mêmes quantités, mêmes parcelles, même date,
 * même ferme, et surtout le MÊME `scan_url` — au caractère près, horodatage
 * d'upload compris. Seuls `numero` et `created_at` diffèrent, de 23 et 29
 * secondes. C'est une double soumission depuis un seul et même scan :
 *   BC-2026-0032 / BC-2026-0033 (25/08, 44 lignes identiques)
 *   BC-2026-0039 / BC-2026-0040 (08/08, 10 lignes identiques)
 *
 * ── DEUX NIVEAUX, À NE PAS CONFONDRE ──────────────────────────────────────
 *  1. `scan_identique` — DOUBLON CERTAIN. Le même fichier de scan est réutilisé
 *     tel quel : zéro faux positif possible, un upload produit un chemin unique
 *     (`scans/bons_consommation/<timestamp>_<nom>`). C'est ce niveau qui aurait
 *     attrapé les deux cas réels ci-dessus.
 *  2. `contenu_identique` — DOUBLON PROBABLE. Mêmes articles, mêmes quantités,
 *     mêmes parcelles, même date, même ferme, mais un `scan_url` DIFFÉRENT :
 *     le bon papier a été rephotographié. Probable, pas certain — deux
 *     apports identiques le même jour sur la même parcelle restent concevables.
 *
 * Les DEUX bloquent (arbitrage Omar), et le message NOMME le bon existant :
 * un message générique obligerait le magasinier à deviner lequel de ses bons
 * fait obstacle. Le magasinier peut forcer, et le forçage est TRACÉ.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ──────────────────────────────────────────
 * Aucun accès Firestore, aucune horloge, aucune identité : le handler lui
 * passe le bon entrant, une liste BORNÉE de bons récents, et l'identité déjà
 * résolue SERVEUR depuis le token. La trace de forçage ne doit JAMAIS être
 * construite à partir du body (cf. `construireTraceForcage`).
 *
 * Testé dans tests/unit/bcDoublons.test.js (+ mutation testing, cf. PR) ;
 * le câblage l'est dans tests/unit/createBcDoublonsWiring.test.js.
 */
// @ts-check
'use strict';

/** Doublon CERTAIN : le bon entrant réutilise le scan d'un bon existant. */
const MOTIF_SCAN = 'scan_identique';

/** Doublon PROBABLE : même contenu métier, scan différent. */
const MOTIF_CONTENU = 'contenu_identique';

/** Action tracée dans l'historique du bon quand le magasinier force. */
const HISTORY_ACTION_FORCAGE = 'doublon_force';

/**
 * Normalise un libellé pour comparaison : majuscules, espaces internes
 * réduits, extrémités coupées. « Sulfate  de Fer » et « SULFATE DE FER »
 * désignent la même ligne de bon.
 * @param {*} v
 * @returns {string}
 */
function normaliserTexte(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Normalise une quantité pour comparaison : nombre arrondi au centième
 * (précision des soldes de stock, cf. updateStockBalance). Une valeur
 * illisible vaut 0 — deux lignes illisibles se comparent alors comme égales,
 * ce qui va dans le sens du blocage, pas du laisser-passer.
 * @param {*} v
 * @returns {number}
 */
function normaliserQuantite(v) {
  const n = parseFloat(v);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Signature du SCAN d'un bon : l'URL, trimée. Chaîne vide si absente — et une
 * signature vide ne matche JAMAIS (cf. `detecterDoublon`), sinon tous les bons
 * saisis à la main, sans scan, seraient doublons les uns des autres.
 * @param {{scan_url?: *}|null|undefined} bc
 * @returns {string}
 */
function signatureScan(bc) {
  if (!bc || bc.scan_url === null || bc.scan_url === undefined) return '';
  return String(bc.scan_url).trim();
}

/**
 * Signature du CONTENU métier d'un bon : date + lignes (article, quantité,
 * parcelle, ferme), triées pour que l'ordre de saisie n'ait aucune influence.
 *
 * Les lignes à quantité nulle sont ignorées : `create-bc` ne leur crée aucun
 * mouvement de stock (`validBcItems`), elles ne font donc pas partie de ce qui
 * distingue deux bons.
 *
 * Chaîne vide si le bon n'a aucune ligne exploitable — et une signature vide
 * ne matche jamais.
 *
 * @param {{date?: *, items?: *}|null|undefined} bc
 * @returns {string}
 */
function signatureContenu(bc) {
  if (!bc) return '';
  const items = Array.isArray(bc.items) ? bc.items : [];
  const lignes = [];
  for (const it of items) {
    if (!it) continue;
    const qte = normaliserQuantite(it.quantite);
    if (qte <= 0) continue;
    lignes.push([
      normaliserTexte(it.article),
      qte.toFixed(2),
      normaliserTexte(it.parcelle),
      normaliserTexte(it.ferme),
    ].join(':'));
  }
  if (!lignes.length) return '';
  lignes.sort();
  return normaliserTexte(bc.date) + '|' + lignes.join(';');
}

/**
 * Message destiné au magasinier. Il NOMME le bon existant et dit lequel des
 * deux cas s'applique : sans le numéro, le magasinier ne peut pas vérifier et
 * forcera systématiquement.
 * @param {string} motif MOTIF_SCAN | MOTIF_CONTENU
 * @param {string} numero numéro du bon existant (ex. 'BC-2026-0032')
 * @returns {string}
 */
function messageDoublon(motif, numero) {
  const ref = numero || 'un bon existant';
  if (motif === MOTIF_SCAN) {
    return 'Doublon : ce scan a déjà servi à créer le bon ' + ref
      + '. Vérifiez ce bon avant de créer celui-ci.';
  }
  return 'Doublon probable : le bon ' + ref
    + ' a déjà les mêmes articles, quantités, parcelles, ferme et date.';
}

/**
 * Le bon entrant est-il un doublon de l'un des bons récents ?
 *
 * Priorité au doublon CERTAIN : si un bon partage le scan, c'est lui qu'on
 * nomme, même si un autre bon partage seulement le contenu. Les bons supprimés
 * (soft-delete) sont ignorés : un bon effacé ne doit pas bloquer sa ressaisie.
 *
 * @param {{scan_url?: *, date?: *, items?: *}} entrant bon en cours de création
 *   (items DÉJÀ éclatés/normalisés par le handler, comme ils seront persistés).
 * @param {Array<{id?: *, numero?: *, deleted?: *, scan_url?: *, date?: *, items?: *}>} bonsRecents
 *   fenêtre BORNÉE de bons existants (jamais tout l'historique).
 * @returns {{doublon: boolean, motif: (string|null), bon_id: string, bon_numero: string, message: string}}
 */
function detecterDoublon(entrant, bonsRecents) {
  const aucun = { doublon: false, motif: null, bon_id: '', bon_numero: '', message: '' };
  const liste = Array.isArray(bonsRecents) ? bonsRecents : [];
  const scanEntrant = signatureScan(entrant);
  const contenuEntrant = signatureContenu(entrant);

  let candidatContenu = null;
  for (const bon of liste) {
    if (!bon) continue;
    if (bon.deleted === true) continue; // bon supprimé : ne bloque pas une ressaisie
    if (scanEntrant && signatureScan(bon) === scanEntrant) {
      return {
        doublon: true,
        motif: MOTIF_SCAN,
        bon_id: String(bon.id || ''),
        bon_numero: String(bon.numero || ''),
        message: messageDoublon(MOTIF_SCAN, String(bon.numero || '')),
      };
    }
    if (!candidatContenu && contenuEntrant && signatureContenu(bon) === contenuEntrant) {
      candidatContenu = bon;
    }
  }

  if (candidatContenu) {
    return {
      doublon: true,
      motif: MOTIF_CONTENU,
      bon_id: String(candidatContenu.id || ''),
      bon_numero: String(candidatContenu.numero || ''),
      message: messageDoublon(MOTIF_CONTENU, String(candidatContenu.numero || '')),
    };
  }
  return aucun;
}

/**
 * Le client demande-t-il explicitement à forcer la création malgré le doublon ?
 *
 * Drapeau EXPLICITE, jamais une valeur « truthy » quelconque : une chaîne
 * parasite ou un `1` résiduel ne doit pas neutraliser la garde par accident.
 * Ce drapeau vient du body, et c'est assumé — ce n'est pas une garde de
 * sécurité mais un garde-fou de saisie. La TRACE, elle, vient du token.
 *
 * @param {*} v valeur brute `req.body.force_doublon`
 * @returns {boolean}
 */
function forcageDemande(v) {
  return v === true || v === 'true';
}

/**
 * Construit la trace du forçage à écrire SUR LE BON créé : qui a forcé, quand,
 * quel bon avait été jugé doublon, et pour quel motif.
 *
 * ⚠️ `by` DOIT être l'identité résolue SERVEUR depuis le token (authUser +
 * resolveCallerRole), jamais un objet du body : sur ce dépôt, un rôle lu depuis
 * le body a déjà été rendu usurpable sans qu'un seul test bronche.
 *
 * @param {Object} args
 * @param {{doublon: boolean, motif: (string|null), bon_id: string, bon_numero: string}} args.verdict
 * @param {{uid?: string, profileId?: string, name?: string}} args.by identité SERVEUR
 * @param {number} args.at timestamp epoch ms
 * @returns {{forced: boolean, by: {uid: string, profileId: string, name: string}, at: number, motif: string, bon_doublon_id: string, bon_doublon_numero: string}}
 */
function construireTraceForcage(args) {
  const o = args || {};
  const v = o.verdict || { motif: null, bon_id: '', bon_numero: '' };
  return {
    forced: true,
    by: {
      uid: (o.by && o.by.uid) || '',
      profileId: (o.by && o.by.profileId) || '',
      name: (o.by && o.by.name) || '',
    },
    at: o.at,
    motif: v.motif || '',
    bon_doublon_id: v.bon_id || '',
    bon_doublon_numero: v.bon_numero || '',
  };
}

module.exports = {
  MOTIF_SCAN,
  MOTIF_CONTENU,
  HISTORY_ACTION_FORCAGE,
  normaliserTexte,
  normaliserQuantite,
  signatureScan,
  signatureContenu,
  messageDoublon,
  detecterDoublon,
  forcageDemande,
  construireTraceForcage,
};
