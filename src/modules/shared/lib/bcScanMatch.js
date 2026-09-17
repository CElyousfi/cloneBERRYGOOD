/**
 * bcScanMatch.js — Rapprochement d'un en-tête de pile manuscrit avec les
 * parcelles RÉELLEMENT proposées par le select de saisie.
 *
 * POURQUOI CÔTÉ FRONT. Le seul référentiel disponible côté serveur,
 * `sb_parcelle_referentiel` (15 entrées), est bien un SOUS-ENSEMBLE des 43
 * labels de `sql_mirror_pointage_meta/br_parcelle_sup` qui alimentent
 * `parcelles-campagne-list`, donc le <select> du magasinier : ses 15 labels y
 * figurent tous (les deux listes ne sont PAS disjointes). Mais c'est un
 * sous-ensemble PARTIEL (15/43) et NON FILTRÉ PAR CAMPAGNE. Rapprocher contre
 * lui revient donc à (a) ne jamais pouvoir proposer les 28 autres parcelles —
 * dont « S3 - MARAVILLA MOTTE F1 », la plus utilisée des bons — et (b) pouvoir
 * proposer une parcelle hors campagne courante, absente du select, donc
 * rejetée. Le serveur ne peut pas non plus savoir quelle liste est affichée
 * (mode conso → refForCampagne, sinon le référentiel général, plus les
 * groupes) : le rapprochement se fait donc ICI, contre les options réellement
 * rendues, ce qui rend par construction impossible une proposition non
 * sélectionnable.
 *
 * DUPLICATION ASSUMÉE. La logique (extractSecteurs / extractVariete /
 * normalizeLabel / matchParcelle) est le MIROIR de
 * `functions/lib/stock/bcScan.js`, qui reste la source de vérité de la
 * convention de libellés. Le backend ne peut pas être requis ici (il n'est pas
 * servi au navigateur) — même arrangement que scanAttachmentUtils.js, qui
 * existe déjà en deux exemplaires dans ce repo. Toute évolution de la
 * convention doit être portée DES DEUX CÔTÉS.
 */
// @ts-check
/**
 * @typedef {{ label: string, nom?: string, culture?: string }} ParcelleOption
 * @typedef {{ label: string, score: number,
 *             status: 'alias'|'exact'|'probable'|'unmatched',
 *             candidats: string[], aliasCount?: number|null }} ParcelleMatch
 * @typedef {{ parcelle?: string, count?: number, campagne?: string }} ParcelleAlias
 */

/**
 * Variétés connues et orthographes manuscrites observées sur les bons.
 * MIROIR de VARIETY_ALIASES (functions/lib/stock/bcScan.js).
 */
import * as CultureUtils from './cultureUtils.js';

var BCSM_VARIETY_ALIASES = {
  maravilla: ['maravilla', 'marvilla', 'marvila', 'maravila'],
  yasmin: ['yasmin', 'yazmin', 'niyas', 'yasminniyas'],
  // « Mya » / « Miya » : deux orthographes du même bloc (« F5- MYA S9 »),
  // relevées sur les bons des 08, 09 et 14/07. Sans cet alias, 3 lignes
  // restaient vides alors que secteur + variété suffisaient à trancher.
  // ⚠️ Doit rester APRÈS `yasmin` : les deux variétés cohabitent sur le
  // secteur 9 (« F5- MYA S9 » et « F5 YAZMIN MT »).
  mya: ['mya', 'miya'],
  mtl: ['mtl'],
  reyna: ['reyna', 'reina'],
  corina: ['corina'],
  breeze: ['breeze', 'brezze'],
  cascade: ['cascade'],
  myrtille: ['myrtille', 'myrtile'],
};

/**
 * Minuscules, sans diacritiques, espaces réduits.
 * @param {*} s
 * @returns {string}
 */
function normalizeLabel(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Réduit un libellé à ses alphanumériques (« M.T.L » === « MTL »).
 * @param {*} s
 * @returns {string}
 */
function squash(s) {
  return normalizeLabel(s).replace(/[^a-z0-9]/g, '');
}

/**
 * Extrait les SECTEURS d'un libellé (en-tête manuscrit ou label de parcelle).
 * « S-3 »/« S 5 » → un secteur ; « S8-2 » → un secteur composé ;
 * « S-13-14 » → DEUX secteurs (tiret juste après le S).
 * @param {*} s
 * @returns {string[]}
 */
function extractSecteurs(s) {
  var txt = normalizeLabel(s);
  if (!txt) return [];
  var out = [];
  var re = /\bs\s*(-?)\s*(\d+)((?:\s*-\s*\d+)*)/g;
  var m = re.exec(txt);
  while (m) {
    var dashAfterS = m[1] === '-';
    var head = m[2];
    var tail = (m[3] || '').split('-').map(function (x) { return x.trim(); }).filter(Boolean);
    if (dashAfterS) {
      out.push('s' + head);
      for (var i = 0; i < tail.length; i++) out.push('s' + tail[i]);
    } else {
      out.push('s' + head + (tail.length ? '-' + tail.join('-') : ''));
    }
    m = re.exec(txt);
  }
  return out.filter(function (v, i) { return out.indexOf(v) === i; });
}

/**
 * Forme canonique de variété détectée dans un libellé ('' si aucune).
 * @param {*} s
 * @returns {string}
 */
function extractVariete(s) {
  var sq = squash(s);
  if (!sq) return '';
  var canons = Object.keys(BCSM_VARIETY_ALIASES);
  for (var i = 0; i < canons.length; i++) {
    var variants = BCSM_VARIETY_ALIASES[canons[i]];
    for (var j = 0; j < variants.length; j++) {
      if (sq.indexOf(variants[j]) !== -1) return canons[i];
    }
  }
  return '';
}

/**
 * Marqueurs de CULTURE lisibles dans un en-tête manuscrit.
 * « M.T.L » = Myrtille (confirmé par Omar, et lisible dans l'en-tête
 * « Variétés » des bons). Signal fiable et non ambigu.
 * Table volontairement minimale : elle ne sert qu'à lire l'EN-TÊTE. La culture
 * d'une PARCELLE, elle, n'est jamais redevinée ici — elle vient de
 * CultureUtils, source de vérité du repo (cf. cultureOfOption).
 */
var BCSM_CULTURE_TOKENS = [
  { culture: 'Myrtille', variants: ['mtl', 'myrtille', 'myrtile', 'blueberry'] },
  { culture: 'Framboise', variants: ['framboise', 'raspberry'] },
  { culture: 'Avocatier', variants: ['avocatier', 'avocat', 'avocado'] },
];

/**
 * Formes qui dénotent une CULTURE et non une variété : présentes dans
 * VARIETY_ALIASES (miroir backend) mais qu'aucune parcelle ne porte comme
 * variété. Les laisser passer pour une variété ferait vetoer à tort tous les
 * candidats d'un en-tête « M.T.L S-13 ».
 */
var BCSM_VARIETE_EST_CULTURE = ['mtl', 'myrtille'];

/**
 * Culture explicitement nommée dans un libellé ('' si aucune — surtout PAS de
 * valeur par défaut : l'absence de signal doit rester l'absence de signal).
 * @param {*} s
 * @returns {string} 'Framboise' | 'Myrtille' | 'Avocatier' | ''
 */
function extractCulture(s) {
  var sq = squash(s);
  if (!sq) return '';
  for (var i = 0; i < BCSM_CULTURE_TOKENS.length; i++) {
    var t = BCSM_CULTURE_TOKENS[i];
    for (var j = 0; j < t.variants.length; j++) {
      if (sq.indexOf(t.variants[j]) !== -1) return t.culture;
    }
  }
  return '';
}

/**
 * Culture d'une OPTION, déléguée à CultureUtils (source de vérité du
 * repo : culture_sb prioritaire, puis heuristique sur le libellé). Lib absente
 * → '' : on ne devine rien et le signal culture est simplement ignoré.
 * @param {{ label: string, hay: string, culture: string }} o
 * @returns {string}
 */
function cultureOfOption(o) {
  var CU = CultureUtils;
  if (!CU || typeof CU.resolveCulture !== 'function') return '';
  return CU.resolveCulture({ label: o.hay, culture: o.culture || '' }, null) || '';
}

/**
 * Restreint une liste d'options à celles de la culture demandée — UNIQUEMENT
 * si ça laisse au moins une option. Le signal culture DÉPARTAGE, il n'exclut
 * jamais tout le monde (une parcelle sans marqueur lisible est classée
 * « Framboise » par défaut côté CultureUtils : en faire un veto dur
 * supprimerait des candidats légitimes).
 * @param {Array<*>} list
 * @param {string} culture
 * @returns {Array<*>}
 */
function narrowByCulture(list, culture) {
  if (!culture || !list.length) return list;
  var kept = list.filter(function (o) { return cultureOfOption(o) === culture; });
  return kept.length ? kept : list;
}

/**
 * Normalise une option de select en { label, hay } (hay = texte fouillé pour
 * la variété : libellé + nom affiché + culture).
 * @param {ParcelleOption|string} o
 * @returns {{ label: string, hay: string, culture: string, secteurs: string[] }|null}
 */
function toOption(o) {
  var label = typeof o === 'string' ? o : (o && o.label) || '';
  label = String(label).trim();
  if (!label) return null;
  var extra = typeof o === 'string' ? '' : [o.nom, o.culture].filter(Boolean).join(' ');
  return {
    label: label,
    hay: label + ' ' + extra,
    culture: (typeof o === 'string' ? '' : o.culture) || '',
    secteurs: extractSecteurs(label),
  };
}

/**
 * ALIAS DE PARCELLE — une décision humaine déjà prise sur CE même en-tête, lors
 * d'un scan précédent (collection `bc_scan_parcelle_aliases`). Trois gardes,
 * toutes indispensables (cf. docs/spec-scan-apprentissage.md §4.1 / R1) :
 *
 *  1. en-tête illisible (`normalizeLabel` -> '') : aucune clé, rien à appliquer ;
 *  2. CAMPAGNE — un alias appris sur une autre campagne n'est JAMAIS appliqué.
 *     Cas réel : le secteur 9 portait « S9 - REYNA F5 » (3 ha) en 2025-2026 et
 *     porte « F5- MYA S9 » + « F5 YAZMIN MT » en 2026-2027. La campagne est déjà
 *     dans la clé du document ET dans le filtre de lecture ; ce contrôle est un
 *     TROISIÈME filet, dans la fonction pure, donc testable et non contournable
 *     par un appelant qui passerait la mauvaise map ;
 *  3. `knownParcelle` A LE DERNIER MOT — un alias dont le libellé n'est plus dans
 *     les options rendues (parcelle sortie de la campagne, renommée…) est ignoré
 *     EN SILENCE et on retombe sur la cascade normale. Sans cette garde, un alias
 *     périmé poserait une valeur non sélectionnable dans le <select>.
 *
 * Le statut rendu est `alias`, jamais `exact` : un alias peut venir d'UNE seule
 * mauvaise sélection du magasinier (le front l'affiche en ⚠️ orange).
 *
 * @param {Object<string, ParcelleAlias|string>|null|undefined} aliases
 * @param {string} entete En-tête manuscrit brut (déjà trimé).
 * @param {*} campagne Campagne courante ('' / absent -> contrôle 2 inerte).
 * @param {Array<{label: string}>} opts Options RÉELLEMENT rendues.
 * @returns {ParcelleMatch|null} Le verdict alias, ou null pour passer à la cascade.
 */
function aliasMatch(aliases, entete, campagne, opts) {
  if (!aliases || typeof aliases !== 'object') return null;
  var key = normalizeLabel(entete);
  if (!key) return null;
  if (!Object.prototype.hasOwnProperty.call(aliases, key)) return null;
  var raw = aliases[key];
  if (!raw) return null;
  var label = String(typeof raw === 'string' ? raw : (raw.parcelle || '')).trim();
  if (!label) return null;
  var aliasCampagne = typeof raw === 'string' ? '' : String(raw.campagne || '');
  if (campagne && aliasCampagne && aliasCampagne !== String(campagne)) return null;
  var connue = opts.some(function (o) { return o.label === label; });
  if (!connue) return null;
  var count = typeof raw === 'string' ? null : (parseInt(String(raw.count), 10) || null);
  return { label: label, score: 1, status: 'alias', candidats: [], aliasCount: count };
}

/**
 * Rapproche un en-tête manuscrit avec les options RÉELLEMENT sélectionnables.
 *
 * Signal le plus fort = le SECTEUR, la variété sert de garde et à départager.
 * Toute ambiguïté → `unmatched` + `candidats[]` : l'utilisateur tranche.
 *
 * Les deux gardes anti-faux-positif ci-dessous sont l'ALIGNEMENT STRICT sur
 * `matchParcelle` de functions/lib/stock/bcScan.js (mêmes cas réels, mêmes
 * seuils, mêmes statuts) : les deux implémentations doivent rendre le même
 * verdict pour un même couple (en-tête, liste).
 *
 * @param {*} enteteLu En-tête manuscrit (ex. 'marvilla S-3').
 * @param {Array<ParcelleOption|string>} options Options du select.
 * @param {Object<string, ParcelleAlias|string>} [aliases] Alias mémorisés,
 *   clé = en-tête normalisé (cf. aliasMatch). Priorité 1 sur la cascade.
 * @param {*} [campagne] Campagne courante — un alias d'une AUTRE campagne est ignoré.
 * @returns {ParcelleMatch}
 */
function matchParcelle(enteteLu, options, aliases, campagne) {
  /** @type {ParcelleMatch} */
  var empty = { label: '', score: 0, status: 'unmatched', candidats: [] };
  var entete = String(enteteLu == null ? '' : enteteLu).trim();
  var opts = (Array.isArray(options) ? options : []).map(toOption).filter(Boolean);
  if (!entete || !opts.length) return empty;

  // (0) ALIAS MÉMORISÉ — priorité absolue, mais jamais au prix d'une valeur
  //     non sélectionnable : aliasMatch rend null et on retombe sur la cascade.
  var alias = aliasMatch(aliases, entete, campagne, opts);
  if (alias) return alias;

  var dedupe = function (arr) { return arr.filter(function (v, i, a) { return a.indexOf(v) === i; }); };
  var labelsOf = function (list) { return dedupe(list.map(function (o) { return o.label; })); };

  var culture = extractCulture(entete);
  var variete = extractVariete(entete);
  // « M.T.L » / « myrtille » désignent la CULTURE, pas une variété : les
  // garder comme variété ferait vetoer tous les candidats d'un « M.T.L S-13 »
  // (aucune parcelle n'est nommée « MTL »).
  if (variete && BCSM_VARIETE_EST_CULTURE.indexOf(variete) !== -1) variete = '';

  var secteurs = extractSecteurs(entete);
  var hits = secteurs.length
    ? opts.filter(function (o) {
      return o.secteurs.some(function (x) { return secteurs.indexOf(x) !== -1; });
    })
    : [];

  /**
   * PASSE 2 — VARIÉTÉ SANS SECTEUR. Certaines parcelles n'ont aucun secteur
   * dans leur libellé (cas réel : « F5 YAZMIN MT », qui porte aujourd'hui le
   * secteur 9) : le rapprochement par secteur ne peut structurellement jamais
   * les trouver. Si l'en-tête nomme une variété et qu'exactement UNE option
   * sans secteur la porte, on la propose — en `probable` seulement, jamais en
   * `exact`.
   * ARBITRAGE PRODUIT — elle ne peut PROPOSER un label que dans deux cas :
   *   (a) l'en-tête ne nomme aucun secteur ;
   *   (b) l'en-tête nomme un secteur qui a au moins une option, mais dont
   *       aucune ne porte la variété (cas réel « yasmin niyas S-9 » : S9 porte
   *       « F5- MYA S9 » et « S9 - REYNA F5 », aucune n'est Yazmin).
   * Si l'en-tête nomme un secteur et que ZÉRO option ne lui correspond, on ne
   * propose rien : le papier affirme un secteur qu'on ne sait pas rattacher,
   * c'est un signal d'incohérence, pas une invitation à deviner (« yazmin
   * S-11 » ne doit pas sortir « F5 YAZMIN MT », qui est au secteur 9). Le
   * label reste offert en `candidats`, à un clic.
   *
   * @param {string[]} candidatsSecteur candidats déjà connus de la passe 1
   * @param {boolean} peutProposer false → suggestion seulement
   * @returns {ParcelleMatch}
   */
  var passeVariete = function (candidatsSecteur, peutProposer) {
    /** @type {ParcelleMatch} */
    var base = { label: '', score: 0, status: 'unmatched', candidats: candidatsSecteur };
    if (!variete) return base;
    var sansSecteur = opts.filter(function (o) {
      if (o.secteurs.length) return false;
      if (extractVariete(o.hay) !== variete) return false;
      // Ne jamais proposer une parcelle dont la culture contredit l'en-tête.
      var c = cultureOfOption(o);
      return !(culture && c && c !== culture);
    });
    if (!sansSecteur.length) return base;
    if (peutProposer && sansSecteur.length === 1) {
      return { label: sansSecteur[0].label, score: 0.9, status: 'probable', candidats: [] };
    }
    return { label: '', score: 0, status: 'unmatched', candidats: dedupe(candidatsSecteur.concat(labelsOf(sansSecteur))) };
  };

  /**
   * Sortie « non résolu » de la passe secteur. La passe variété prend le
   * relais SAUF si un candidat du secteur porte déjà la variété de l'en-tête :
   * dans ce cas le secteur est bien couvert par un label dédié et proposer une
   * parcelle sans secteur serait un faux positif (cas réel :
   * « S10 YAZMIN cut back » ne doit PAS tomber sur « F5 YAZMIN MT »).
   * @param {Array<*>} restants options encore plausibles
   * @returns {ParcelleMatch}
   */
  var nonResolu = function (restants) {
    var candidats = labelsOf(narrowByCulture(restants, culture));
    var couvertParLeSecteur = !!variete && hits.some(function (o) { return extractVariete(o.hay) === variete; });
    if (couvertParLeSecteur) return { label: '', score: 0, status: 'unmatched', candidats: candidats };
    // Cas (b) : le secteur existe dans la liste mais aucune option ne porte la
    // variété — la passe variété peut proposer.
    return passeVariete(candidats, true);
  };

  // Cas (a) : aucun secteur nommé — la passe variété peut proposer.
  if (!secteurs.length) return passeVariete([], true);

  // En-tête couvrant 2 secteurs (« M.T.L S-13-14 ») : on ne devine pas. Le
  // signal culture affine quand même la liste de suggestions.
  if (secteurs.length > 1) {
    return { label: '', score: 0, status: 'unmatched', candidats: labelsOf(narrowByCulture(hits, culture)) };
  }
  // L'en-tête nomme un secteur inconnu de la liste : on ne propose rien, la
  // variété ne sert qu'à suggérer (cf. arbitrage dans passeVariete).
  if (!hits.length) return passeVariete([], false);

  // GARDE ANTI-FAUX-POSITIF (1) — une option dont le libellé couvre PLUSIEURS
  // secteurs n'est jamais proposée pour un en-tête qui n'en nomme qu'un.
  // Cas réel : « marvilla S-5 » → « S2.S3.S5.S6.S7 maravilla logn can F1 »,
  // qui imputerait la consommation d'un secteur à un groupe de 5 parcelles.
  // Elle reste listée en `candidats` : c'est à l'utilisateur de trancher.
  var mono = hits.filter(function (o) { return o.secteurs.length === 1; });
  var multi = hits.filter(function (o) { return o.secteurs.length > 1; });
  var tous = mono.concat(multi);
  if (!mono.length) return nonResolu(tous);

  // GARDE ANTI-FAUX-POSITIF (2) — une option qui nomme une AUTRE variété que
  // l'en-tête n'est jamais proposée, même seule sur le secteur (cas réel
  // « marvilla S-5 » vs « S5 -YAZMIN MOW DOWN F1 »). Une option sans variété
  // identifiable ne contredit rien : elle reste éligible.
  var eligibles = mono;

  // GARDE ANTI-FAUX-POSITIF (3) — une option dont la CULTURE contredit
  // l'en-tête n'est jamais proposée. Doit passer AVANT le raccourci
  // « seule sur son secteur → exact » : sans elle, « M.T.L S-3 » (Myrtille)
  // sortait « S3 - MARAVILLA MOTTE F1 » (Framboise) en `exact` score 1, donc
  // avec une pastille ✅ « Reconnu » — un bon myrtille parti sur une parcelle
  // framboise, sans aucun signal invitant à vérifier.
  // Limitée au sens SÛR : seules « Myrtille » et « Avocatier » sont
  // considérées, car `resolveCulture` ne les attribue jamais par défaut (son
  // défaut est « Framboise »). Une option dont la culture n'est pas résolue ne
  // contredit rien et reste éligible.
  if (culture === 'Myrtille' || culture === 'Avocatier') {
    eligibles = eligibles.filter(function (o) {
      var c = cultureOfOption(o);
      return !c || c === culture;
    });
    if (!eligibles.length) return nonResolu(tous);
  }

  if (variete) {
    eligibles = eligibles.filter(function (o) {
      var v = extractVariete(o.hay);
      return !v || v === variete;
    });
    if (!eligibles.length) return nonResolu(tous);
    var exacts = eligibles.filter(function (o) { return extractVariete(o.hay) === variete; });
    if (exacts.length === 1) {
      var seuleSurSecteur = mono.length === 1;
      return {
        label: exacts[0].label,
        score: seuleSurSecteur ? 1 : 0.9,
        status: seuleSurSecteur ? 'exact' : 'probable',
        candidats: [],
      };
    }
  }

  if (eligibles.length === 1 && mono.length === 1) {
    return { label: eligibles[0].label, score: 1, status: 'exact', candidats: [] };
  }

  // SIGNAL CULTURE — dernier recours avant d'abandonner : il DÉPARTAGE des
  // candidats déjà retenus par le secteur, il n'élargit jamais la recherche.
  // Cas réel : « M.T.L S-13 » (Myrtille) entre « F5- CASCADE -S13 » (myrtille)
  // et « S13 - YAZMIN MOW DOWN F5 » (framboise).
  if (culture) {
    var byCulture = eligibles.filter(function (o) { return cultureOfOption(o) === culture; });
    if (byCulture.length === 1) {
      return { label: byCulture[0].label, score: 0.9, status: 'probable', candidats: [] };
    }
  }

  return nonResolu(tous);
}

export { BCSM_VARIETY_ALIASES as VARIETY_ALIASES, BCSM_CULTURE_TOKENS as CULTURE_TOKENS, normalizeLabel, extractSecteurs, extractVariete, extractCulture, aliasMatch, matchParcelle };
