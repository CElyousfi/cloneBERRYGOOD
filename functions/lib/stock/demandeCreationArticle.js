'use strict';

// @ts-check

/**
 * demandeCreationArticle.js — Module PUR : le magasinier DEMANDE, le DG CRÉE.
 *
 * ── LA DÉCISION D'OMAR ────────────────────────────────────────────────────
 * « On demande au magasinier de demander la création de l'article et de la
 * soumettre au DG. » Le refus fail-closed posé par `identiteArticle` empêche
 * un solde orphelin de naître ; il ne doit pas pour autant laisser le
 * magasinier sans issue. Sur les écrans de saisie libre (transfert, sortie,
 * bon de consommation), le bouton « Créer cet article au catalogue » n'existe
 * pas — et `public/app.jsx` est GELÉ (migration en cours). La sortie est donc
 * SERVEUR : le refus enregistre lui-même une demande de création.
 *
 * ── LA RÉCEPTION NE BLOQUE JAMAIS ─────────────────────────────────────────
 * Une ligne de bon de livraison vient d'un BDC déjà validé par le DG : le
 * magasinier n'a pas choisi ce libellé. Le bloquer serait le punir pour une
 * décision d'achat qui n'est pas la sienne. La réception est donc TOUJOURS
 * enregistrée ; la ligne non résolue est simplement ÉCARTÉE du stock et
 * marquée. Mesuré : 16 lignes de BDC en attente sont dans ce cas (rouleau
 * adhésif, film, souffleur, substrat) — du matériel qui n'a pas vocation à
 * être tenu en stock.
 *
 * ── DÉDOUBLONNAGE STRUCTUREL ──────────────────────────────────────────────
 * L'identifiant du document est DÉRIVÉ du libellé canonique. Deux magasiniers
 * qui demandent le même article ne peuvent donc pas créer deux demandes, même
 * en cas de course : c'est le même document. Le dédoublonnage ne repose pas
 * sur une requête préalable qu'on pourrait oublier de faire.
 *
 * Aucune dépendance Firestore : 100 % pur, testable unitairement.
 */

const crypto = require('node:crypto');
const { canon } = require('./articleKey');
const { resoudreIdentite, ISSUE_RESOLU, ISSUE_INTROUVABLE, ISSUE_AMBIGU } = require('./identiteArticle');

/** Demande ouverte : le DG n'a pas encore créé la fiche. */
const STATUT_EN_ATTENTE = 'en_attente';
/** Demande close : une fiche active porte désormais ce libellé. */
const STATUT_CREE = 'cree';

/** Collection Firestore des demandes. */
const COLLECTION = 'article_creation_requests';

/**
 * @typedef {Object} Demande
 * @property {string} [id] docId.
 * @property {string} libelle Libellé demandé, tel que saisi.
 * @property {string} cle Libellé canonique — clé de dédoublonnage.
 * @property {string} statut
 * @property {*} [demande_par] @property {*} [demande_at]
 * @property {*} [contexte] @property {*} [occurrences]
 */

/**
 * Identifiant DÉTERMINISTE d'une demande, dérivé du libellé canonique.
 *
 * Le dédoublonnage est ainsi STRUCTUREL : deux demandes du même article
 * s'écrivent dans le même document, y compris si elles arrivent en même temps
 * depuis deux appareils. Un dédoublonnage par requête préalable
 * (`where cle == …`) laisserait passer les courses, et pourrait être retiré
 * sans que rien ne casse visiblement.
 *
 * Firestore interdit `/` dans un docId et n'aime pas les identifiants vides :
 * on translittère, et on refuse un libellé vide en amont (`libellesADemander`).
 *
 * @param {*} libelle
 * @returns {string} docId ('' si le libellé est vide)
 */
function identifiantDemande(libelle) {
  const cle = canon(libelle);
  if (!cle) return '';
  // ⚠️ La partie LISIBLE est LOSSY, et le rester est délibéré : elle sert à
  // reconnaître la demande d'un coup d'œil dans la console Firestore. Mais
  // seule, elle FUSIONNE des articles distincts — mesuré :
  //   « NPK 12-12-17 » et « NPK 12 12 17 » → ACR-NPK_12_12_17
  //   « ACIDE 20% »   et « ACIDE 20 »      → ACR-ACIDE_20
  //   « ÉTIQUETTE »                        → ACR-TIQUETTE (le É est mangé)
  // Deux articles réellement différents partageraient alors un document, et le
  // DG n'en verrait qu'un. Le suffixe de hachage rend l'identifiant INJECTIF
  // sur `cle` : la lisibilité est un confort, l'unicité est une garantie.
  const lisible = cle.replace(/[^A-Z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const empreinte = crypto.createHash('sha1').update(cle).digest('hex').slice(0, 8);
  return 'ACR-' + (lisible ? lisible + '-' : '') + empreinte;
}

/**
 * Libellés méritant une demande de création, parmi des résolutions fautives.
 *
 * ⚠️ SEUL le cas INTROUVABLE en produit une. Un libellé AMBIGU correspond à
 * DEUX fiches actives : le catalogue en a déjà trop, en créer une troisième
 * aggraverait exactement le problème que ce chantier ferme. Un cas ambigu se
 * règle par une FUSION, et le message de refus le dit déjà.
 *
 * @param {Array<{issue?: string, libelle?: string}>} resolutions
 * @returns {string[]} libellés distincts, ordre d'apparition.
 */
function libellesADemander(resolutions) {
  /** @type {string[]} */
  const out = [];
  const vus = new Set();
  for (const r of Array.isArray(resolutions) ? resolutions : []) {
    if (!r || r.issue !== ISSUE_INTROUVABLE) continue;
    const libelle = r.libelle == null ? '' : String(r.libelle).trim();
    if (!libelle) continue;
    const cle = canon(libelle);
    if (!cle || vus.has(cle)) continue;
    vus.add(cle);
    out.push(libelle);
  }
  return out;
}

/**
 * Écarts qui doivent ALERTER le DG sans ouvrir de demande de création.
 *
 * ── LE TROU QUE CETTE FONCTION FERME ──────────────────────────────────────
 * `libellesADemander` ne retient que `ISSUE_INTROUVABLE` — à raison. Mais rien
 * n'avait été mis à la place pour les DEUX autres cas, et l'appelant sortait
 * avant toute notification. Exécution réelle sur un BDC contenant `OPAL` avec
 * deux fiches actives : la ligne n'entrait pas en stock, aucune demande
 * n'était écrite, ZÉRO alerte n'était émise, et le bon portait le motif
 * « article absent du catalogue — une demande a été envoyée au DG », faux deux
 * fois. De la marchandise reçue disparaissait sans le moindre signal : la
 * panne silencieuse exacte que ce chantier prétend fermer.
 *
 * Deux familles, toutes deux SANS création d'article :
 *  - `ambigu` : l'article existe DEUX fois. Le remède est une FUSION, pas une
 *    création — en créer une troisième aggraverait le défaut.
 *  - `sans_libelle` : la ligne n'a pas d'article du tout. Il n'y a rien à
 *    créer ; c'est la saisie ou le BDC qu'il faut corriger.
 *
 * @param {Array<{issue?: string, libelle?: string, candidats?: Array<*>}>} resolutions
 * @returns {Array<{motif: 'ambigu'|'sans_libelle', libelle: string, candidats: Array<*>}>}
 */
function ecartsASignaler(resolutions) {
  /** @type {Array<{motif: 'ambigu'|'sans_libelle', libelle: string, candidats: Array<*>}>} */
  const out = [];
  const vus = new Set();
  for (const r of Array.isArray(resolutions) ? resolutions : []) {
    if (!r) continue;
    const libelle = r.libelle == null ? '' : String(r.libelle).trim();
    if (r.issue === ISSUE_AMBIGU) {
      const cle = 'A:' + canon(libelle);
      if (vus.has(cle)) continue;
      vus.add(cle);
      out.push({ motif: 'ambigu', libelle, candidats: Array.isArray(r.candidats) ? r.candidats : [] });
      continue;
    }
    // Ligne sans article : `canon('')` est vide, elle échappait à TOUT — pas
    // même marquée sur le bon.
    if (r.issue === ISSUE_INTROUVABLE && !libelle) {
      if (vus.has('V')) continue;
      vus.add('V');
      out.push({ motif: 'sans_libelle', libelle: '', candidats: [] });
    }
  }
  return out;
}

/**
 * Message d'alerte au DG pour les écarts NON demandables.
 * Il doit dire QUOI FAIRE : « fusionnez », pas « il y a un problème ».
 * @param {ReturnType<typeof ecartsASignaler>} ecarts
 * @param {*} [contexte] {origine, type, numero}
 * @returns {string} '' si rien à signaler — on n'envoie jamais d'alerte vide.
 */
function messageSignalement(ecarts, contexte) {
  const liste = Array.isArray(ecarts) ? ecarts : [];
  if (!liste.length) return '';
  const ou = contexte && contexte.numero ? ' (' + String(contexte.numero) + ')' : '';
  const phrases = [];
  const ambigus = liste.filter((e) => e.motif === 'ambigu');
  if (ambigus.length) {
    const details = ambigus.map((e) => {
      // Le LIBELLÉ de chaque fiche, pas seulement son identifiant : c'est
      // souvent lui qui les distingue (« OPAL » vs « Opal (L) »), et le DG lit
      // ce message sur son téléphone. « Ref-Eng0052 / Ref-Eng0177 » ne lui dit
      // pas laquelle garder.
      const noms = (e.candidats || [])
        .map((c) => {
          if (!c) return '';
          const nom = c.nom == null ? '' : String(c.nom).trim();
          const id = c.id == null ? '' : String(c.id);
          if (nom && id) return nom + ' [' + id + ']';
          return nom || id;
        })
        .filter(Boolean).join(' / ');
      return '« ' + e.libelle + ' »' + (noms ? ' (' + noms + ')' : '');
    }).join(', ');
    phrases.push(
      'Stock bloqué : ' + details + ' existe en DOUBLE au catalogue. '
      + 'La marchandise n\'entre pas en stock tant que les fiches ne sont pas FUSIONNÉES. '
      + 'Ne pas créer de nouvelle fiche.'
    );
  }
  if (liste.some((e) => e.motif === 'sans_libelle')) {
    phrases.push('Une ligne sans article a été reçue' + ou + ' : elle n\'entre pas en stock, le bon est à corriger.');
  }
  return phrases.join(' ');
}

/**
 * Motif d'écart d'UNE ligne, DÉRIVÉ de son issue.
 *
 * Il était écrit en constante : toute ligne écartée portait « article absent
 * du catalogue … une demande de création a été envoyée au DG », y compris
 * quand l'article était en DOUBLE (donc bien présent) et qu'aucune demande
 * n'était partie. Un motif faux est pire qu'un motif absent : il envoie le
 * lecteur créer une fiche là où il fallait en fusionner deux.
 *
 * @param {{issue?: string, libelle?: string, candidats?: Array<*>}} resolution
 * @returns {string}
 */
function motifEcart(resolution) {
  const r = resolution || {};
  const libelle = r.libelle == null ? '' : String(r.libelle).trim();
  if (r.issue === ISSUE_AMBIGU) {
    const n = Array.isArray(r.candidats) ? r.candidats.length : 2;
    return 'Article en DOUBLE au catalogue (' + n + ' fiches actives) : la ligne est reçue '
      + 'mais n\'entre pas en stock tant que les fiches ne sont pas fusionnées. Le DG a été alerté.';
  }
  if (!libelle) {
    return 'Ligne sans article : elle est reçue mais n\'entre pas en stock. Le DG a été alerté.';
  }
  return 'Article absent du catalogue : la ligne est reçue mais n\'entre pas en stock. '
    + 'Une demande de création a été envoyée au DG.';
}

/**
 * Document de demande à écrire (merge), pour UN libellé.
 *
 * `occurrences` et `history` s'accumulent : une demande redemandée n'écrase pas
 * la précédente, elle la renforce — c'est ce qui permet au DG de voir qu'un
 * article est réclamé dix fois plutôt qu'une.
 *
 * @param {Object} p
 * @param {string} p.libelle
 * @param {*} [p.demandePar] {uid, profileId, name}
 * @param {*} [p.contexte] {origine, type, numero}
 * @param {number} p.maintenant
 * @returns {{id: string, data: Object}}
 */
function construireDemande(p) {
  const params = p || {};
  const libelle = String(params.libelle == null ? '' : params.libelle).trim();
  const at = typeof params.maintenant === 'number' ? params.maintenant : Date.now();
  const par = params.demandePar || {};
  const contexte = params.contexte || {};
  return {
    id: identifiantDemande(libelle),
    data: {
      libelle,
      cle: canon(libelle),
      statut: STATUT_EN_ATTENTE,
      derniere_demande_at: at,
      derniere_demande_par: {
        uid: par.uid || '',
        profileId: par.profileId || '',
        name: par.name || '',
      },
      dernier_contexte: {
        origine: contexte.origine || '',
        type: contexte.type || '',
        numero: contexte.numero || '',
      },
      // Réouverture explicite : si le DG avait créé puis supprimé la fiche, la
      // demande redevient ouverte au lieu de rester close sur un catalogue qui
      // ne porte plus l'article.
      cree_at: null,
      cree_article_id: null,
      updated_at: at,
    },
  };
}

/**
 * Message rendu au magasinier après un refus.
 *
 * Il NOMME l'article et dit ce qui vient de se passer : sans cette seconde
 * phrase, l'utilisateur voit un refus sec et n'a aucune raison de croire que
 * quelqu'un s'en occupe — il ressaisira le même bon en boucle.
 *
 * @param {Array<{issue?: string, libelle?: string, erreur?: string}>} resolutions
 * @param {string[]} demandesEnregistrees libellés réellement enregistrés
 * @returns {string}
 */
function messageRefus(resolutions, demandesEnregistrees) {
  const liste = Array.isArray(resolutions) ? resolutions : [];
  const demandes = new Set((Array.isArray(demandesEnregistrees) ? demandesEnregistrees : []).map((l) => canon(l)));
  const phrases = liste.map((r) => {
    const libelle = r && r.libelle != null ? String(r.libelle) : '';
    if (r && r.issue === ISSUE_INTROUVABLE && demandes.has(canon(libelle))) {
      return 'Article « ' + libelle + ' » inconnu — une demande de création a été envoyée au DG.';
    }
    return (r && r.erreur) || '';
  });
  return phrases.filter(Boolean).join(' ');
}

/**
 * Partitionne des lignes de réception : ce qui entre en stock, ce qui est écarté.
 *
 * C'est le cœur de la décision d'Omar sur la réception. Une ligne écartée
 * n'est PAS perdue : elle reste sur le bon de livraison, marquée, et produit
 * une demande de création. Elle ne produit simplement AUCUN mouvement de
 * stock — écrire un mouvement sous un libellé non résolu recréerait le solde
 * orphelin que tout ce chantier supprime.
 *
 * @param {Array<Object>} lignes
 * @param {*} idx Index d'identité (`identiteArticle.indexerFiches`).
 * @returns {{retenues: Array<Object>, ecartees: Array<Object>, resolutions: Array<Object>}}
 */
function partitionnerLignesReception(lignes, idx) {
  /** @type {Array<Object>} */
  const retenues = [];
  /** @type {Array<Object>} */
  const ecartees = [];
  /** @type {Array<Object>} */
  const resolutions = [];
  for (const ligne of Array.isArray(lignes) ? lignes : []) {
    const libelle = ligne && (ligne.article || ligne.article_ref || ligne.article_nom) || '';
    const r = resoudreIdentite(libelle, idx);
    if (r.issue === ISSUE_RESOLU) {
      retenues.push(ligne);
    } else {
      resolutions.push(r);
      ecartees.push(ligne);
    }
  }
  return { retenues, ecartees, resolutions };
}

/**
 * Marque les lignes d'un bon de livraison écartées du stock.
 *
 * Le BL garde TOUTES ses lignes — c'est le document du fournisseur, on n'en
 * retire rien. On y inscrit seulement pourquoi certaines n'ont pas bougé le
 * stock : sans cette marque, l'écart entre le BL et le mouvement de réception
 * serait invisible et passerait pour une perte.
 *
 * ⚠️ L'appariement se fait par IDENTITÉ D'OBJET, pas par libellé.
 * Il comparait `canon(it.article)` : une ligne du même article mais à
 * `quantite_recue = 0` — que la partition n'examine même pas, puisqu'elle ne
 * voit que les lignes reçues — se retrouvait marquée `hors_stock` à tort. Une
 * ligne non livrée aurait ainsi porté un motif d'écart de stock, qui n'a aucun
 * sens pour elle. `ecartees` contient les objets EUX-MÊMES (le `filter` amont
 * ne copie pas), l'identité est donc l'appariement exact.
 *
 * Le motif est DÉRIVÉ de la résolution de chaque ligne (`resolutions[i]`
 * correspond à `ecartees[i]`) : il dit la vérité sur CE qui bloque.
 *
 * @param {Array<Object>} blItems
 * @param {Array<Object>} ecartees lignes écartées (mêmes objets que dans blItems)
 * @param {Array<Object>} [resolutions] résolutions, alignées sur `ecartees`
 * @returns {Array<Object>} nouvelles lignes
 */
function marquerLignesEcartees(blItems, ecartees, resolutions) {
  const liste = Array.isArray(ecartees) ? ecartees : [];
  const res = Array.isArray(resolutions) ? resolutions : [];
  const motifs = new Map();
  liste.forEach((ligne, i) => {
    if (ligne && typeof ligne === 'object') motifs.set(ligne, motifEcart(res[i]));
  });
  return (Array.isArray(blItems) ? blItems : []).map((it) => {
    if (!motifs.has(it)) return it;
    return Object.assign({}, it, {
      hors_stock: true,
      hors_stock_motif: motifs.get(it),
    });
  });
}

/**
 * Demandes à CLORE : celles dont le libellé se résout désormais à une fiche
 * active. La clôture est donc décidée par la MÊME règle (`canon`) que tout le
 * reste du domaine — pas par une comparaison de noms réécrite ici.
 *
 * @param {Demande[]} demandes
 * @param {*} idx Index d'identité.
 * @returns {Array<{id: string, article_id: string}>}
 */
function demandesAClore(demandes, idx) {
  /** @type {Array<{id: string, article_id: string}>} */
  const out = [];
  for (const d of Array.isArray(demandes) ? demandes : []) {
    if (!d || !d.id) continue;
    if (d.statut !== STATUT_EN_ATTENTE) continue;
    const r = resoudreIdentite(d.libelle, idx);
    if (r.issue !== ISSUE_RESOLU) continue;
    out.push({ id: String(d.id), article_id: r.ficheId });
  }
  return out;
}

/**
 * Message WhatsApp au DG. Court, mobile, français — et NOMMANT l'article :
 * une alerte « une demande est arrivée » oblige à ouvrir l'app pour savoir
 * quoi faire, et ne sera pas traitée.
 * @param {string[]} libelles @param {*} [par]
 * @returns {string}
 */
function messageWhatsApp(libelles, par) {
  const liste = (Array.isArray(libelles) ? libelles : []).filter(Boolean);
  const qui = (par && (par.name || par.profileId)) || 'un magasinier';
  if (!liste.length) return '';
  const articles = liste.map((l) => '« ' + l + ' »').join(', ');
  return liste.length === 1
    ? 'Article à créer au catalogue : ' + articles + ', demandé par ' + qui
      + '. Sans cette fiche, le stock de cet article ne peut pas être tenu.'
    : liste.length + ' articles à créer au catalogue : ' + articles + ', demandés par '
      + qui + '. Sans ces fiches, leur stock ne peut pas être tenu.';
}

module.exports = {
  COLLECTION,
  STATUT_EN_ATTENTE,
  STATUT_CREE,
  identifiantDemande,
  libellesADemander,
  ecartsASignaler,
  messageSignalement,
  motifEcart,
  construireDemande,
  messageRefus,
  partitionnerLignesReception,
  marquerLignesEcartees,
  demandesAClore,
  messageWhatsApp,
}
