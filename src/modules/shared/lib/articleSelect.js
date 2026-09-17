/**
 * articleSelect.js — SÉLECTION FERMÉE d'un article de catalogue.
 *
 * ── LE DÉFAUT QU'IL FERME ─────────────────────────────────────────────────
 * Le champ « Article » du bon de consommation était un `<input list>` + une
 * `<datalist>` : il RESSEMBLE à une liste déroulante avec recherche, et accepte
 * en réalité n'importe quelle saisie. Toute faute de frappe entrait dans le
 * système comme un article, et le serveur devait la refuser après coup.
 * Demande d'Omar : « on passe l'article du bon de consommation en liste
 * déroulante avec champ de sélection en tapant le nom ».
 *
 * ── CE QUE CE MODULE NE FAIT PAS ──────────────────────────────────────────
 * Il ne remplace PAS le refus serveur. Le scan de bon (`MagBCScanModal`) et les
 * appels directs à l'API n'empruntent pas ce champ : la garde qui fait foi
 * reste `create-bc` (`identiteArticle.resoudreLignes` + `uniteFigee.figerLignes`).
 * Fermer le sélecteur rend le refus RARE, il ne le remplace pas.
 *
 * Il ne corrige pas non plus une fiche dont l'unité est FAUSSE : `RHIZO MN ZN`
 * est déclarée en litres pour un article pesé en kilos. Choisir dans la liste
 * hériterait proprement d'une unité fausse — c'est le gel serveur qui attrape
 * ce cas, pas ce module.
 *
 * ── DEUX CLÉS, ET IL NE FAUT PAS LES CONFONDRE ────────────────────────────
 *  - `cleIdentite` est le MIROIR EXACT de `functions/lib/stock/articleKey.js:canon`,
 *    la règle d'identité du dépôt. Elle décide si deux libellés désignent le
 *    même article. Toute divergence avec le backend ferait accepter à l'écran
 *    un article que le serveur refuse (ou l'inverse) ;
 *  - `cleRecherche` ajoute le repli des accents et des séparateurs. Elle sert
 *    UNIQUEMENT à filtrer ce que le magasinier tape (vite, sur mobile,
 *    « acide phos » doit trouver « ACIDE PHOSPHORIQUE »). Elle ne décide
 *    JAMAIS d'une identité : plier les accents pour l'identité rapprocherait
 *    des fiches que le serveur tient pour distinctes.
 *
 * ── L'AMBIGUÏTÉ N'EST PAS TRANCHÉE ICI ────────────────────────────────────
 * Plusieurs fiches actives peuvent porter le même libellé (le catalogue en
 * porte ~105 paires). Le bon transporte un NOM, pas un docId : une entrée
 * ambiguë est donc INDÉSAMBIGUÏSABLE depuis cet écran, quoi qu'on affiche.
 * `identiteArticle` (lot #362) refuse ce cas et nomme les deux fiches ; ce
 * module fait pareil — il MONTRE l'entrée, la marque, et refuse de la valider.
 * L'élire au hasard remplacerait une saisie libre par un choix ambigu, ce qui
 * n'est pas mieux.
 *
 * Module PUR : aucun accès réseau, aucun DOM, aucune horloge.
 */
// @ts-check

/**
 * Clé d'IDENTITÉ — miroir exact de functions/lib/stock/articleKey.js:canon.
 * MAJUSCULE + espaces réduits + suffixe « (L|KG|G|ML|UNITE|U) » final retiré.
 * C'est ce dernier point qui fait tomber `ACIDE PHOSPHORIQUE (L)` et
 * `Acide Phosphorique` dans le MÊME seau.
 *
 * ⚠️ NE PAS « améliorer » sans changer le backend en même temps : une règle
 * plus permissive ici ferait valider à l'écran un article que le serveur
 * refuse, et le magasinier verrait un bon rejeté sans comprendre pourquoi.
 * @param {*} a
 * @returns {string}
 */
function cleIdentite(a) {
  var s = (a === null || a === undefined ? '' : String(a)).toUpperCase().trim();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*\((L|KG|G|ML|UNITE|U)\)\s*$/, '');
  return s.trim();
}

/**
 * Clé de RECHERCHE — filtrage seulement, jamais l'identité.
 * Replie les accents et écrase tout séparateur : le magasinier tape vite et
 * sur mobile, « acide phos » doit trouver « ACIDE PHOSPHORIQUE », et
 * « SEQUESTRENE » doit trouver « Séquestrène ».
 * @param {*} a
 * @returns {string}
 */
function cleRecherche(a) {
  var s = cleIdentite(a);
  // NFD + suppression des diacritiques. `normalize` existe sur tous les
  // navigateurs visés ; la garde évite un crash si un jour ce n'est plus vrai.
  if (typeof s.normalize === 'function') {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return s.replace(/[^A-Z0-9]+/g, '');
}

/**
 * Une fiche est-elle CHOISISSABLE ?
 * Garde POSITIVE, alignée sur `identiteArticle.ficheVivante` : on n'accepte
 * que ce qui est explicitement une fiche active et nommée. Les 5 documents
 * fantômes du catalogue (sans `nom` ni `active`) ne doivent pas devenir des
 * options — les proposer ferait choisir un article que le serveur refuse.
 * @param {*} a
 * @returns {boolean}
 */
function ficheChoisissable(a) {
  if (!a || typeof a !== 'object') return false;
  if (!a.id) return false;
  if (a.active === false) return false;
  if (a.merged_into) return false;
  return !!cleIdentite(a.nom);
}

/**
 * @typedef {Object} EntreeCatalogue
 * @property {string} cle        clé d'identité (`cleIdentite`).
 * @property {string} recherche  clé de filtrage (`cleRecherche`).
 * @property {string} nom        libellé affiché ET envoyé au serveur.
 * @property {Array<*>} fiches   fiches actives portant cette identité.
 * @property {boolean} ambigu    true si 2+ fiches — non choisissable.
 */

/**
 * Index du catalogue : UNE entrée par identité.
 *
 * Le dédoublonnage se fait sur `cleIdentite`, pas sur le nom brut : sinon
 * `ACIDE PHOSPHORIQUE (L)` et `Acide Phosphorique` restent deux lignes à
 * l'écran alors que le serveur les tient pour le même article — le magasinier
 * choisirait entre deux options qui ne se distinguent pas.
 *
 * @param {Array<*>} articles catalogue (`list-articles`, fiches actives).
 * @returns {{entrees: Array<EntreeCatalogue>, parCle: Object<string, EntreeCatalogue>}}
 */
function indexerCatalogue(articles) {
  var liste = Array.isArray(articles) ? articles : [];
  var parCle = {};
  var entrees = [];
  for (var i = 0; i < liste.length; i++) {
    var a = liste[i];
    if (!ficheChoisissable(a)) continue;
    var cle = cleIdentite(a.nom);
    var deja = parCle[cle];
    if (deja) {
      deja.fiches.push(a);
      deja.ambigu = deja.fiches.length > 1;
      continue;
    }
    var e = {
      cle: cle,
      recherche: cleRecherche(a.nom),
      nom: String(a.nom).trim(),
      fiches: [a],
      ambigu: false,
    };
    parCle[cle] = e;
    entrees.push(e);
  }
  entrees.sort(function (x, y) { return x.nom.localeCompare(y.nom, 'fr', { sensitivity: 'base' }); });
  return { entrees: entrees, parCle: parCle };
}

/**
 * Options proposées pour ce que le magasinier vient de taper.
 *
 * Saisie vide → TOUT le catalogue (une liste déroulante doit s'ouvrir même
 * sans frappe : c'est ce qui la distingue d'un champ libre).
 * Sinon, les entrées dont la clé de recherche CONTIENT la saisie, celles qui
 * commencent par elle d'abord — la frappe la plus courante est un préfixe.
 *
 * @param {{entrees?: Array<EntreeCatalogue>}} index
 * @param {*} saisie
 * @param {number} [limite] nombre maximal d'options rendues.
 * @returns {Array<EntreeCatalogue>}
 */
function filtrerEntrees(index, saisie, limite) {
  var entrees = (index && Array.isArray(index.entrees)) ? index.entrees : [];
  var max = typeof limite === 'number' && limite > 0 ? limite : 50;
  var q = cleRecherche(saisie);
  if (!q) return entrees.slice(0, max);
  var prefixes = [];
  var contient = [];
  for (var i = 0; i < entrees.length; i++) {
    var pos = entrees[i].recherche.indexOf(q);
    if (pos === 0) prefixes.push(entrees[i]);
    else if (pos > 0) contient.push(entrees[i]);
  }
  return prefixes.concat(contient).slice(0, max);
}

/** La saisie correspond EXACTEMENT à une identité du catalogue. */
var ISSUE_CHOISI = 'choisi';
/**
 * FRAPPE EN COURS : la saisie n'est pas (encore) un article, mais des
 * articles du catalogue lui correspondent. Ni une erreur, ni un choix.
 *
 * ── LE DÉFAUT QUE CETTE ISSUE FERME ───────────────────────────────────
 * Omar, sur le preview : « Il doit afficher les suggestions des articles
 * avec dropdown. Aujourd'hui il suggère d'ajouter pour tous, même pour
 * articles existants. » Il tape `sulfate` et se voit proposer « Demander la
 * création au DG » alors que le catalogue porte NEUF articles « Sulfate … ».
 *
 * La cause : `inconnu` était rendu dès que la frappe n'égalait pas
 * EXACTEMENT une fiche — donc à chaque lettre d'une saisie normale. Vérifié
 * sur le catalogue de production : `sulfate` (9 correspondances), `acide`
 * (8), `nitr` (10) déclenchaient tous le bouton de création.
 *
 * Séparer `en_cours` de `inconnu` rend au bouton son sens : il n'apparaît
 * plus QUE lorsque rien ne correspond.
 */
var ISSUE_EN_COURS = 'en_cours';
/** La saisie ne correspond à RIEN : le magasinier doit demander la création. */
var ISSUE_INCONNU = 'inconnu';
/** L'identité désigne 2+ fiches actives : indécidable depuis cet écran. */
var ISSUE_AMBIGU = 'ambigu';
/** Rien n'est saisi. */
var ISSUE_VIDE = 'vide';

/**
 * @typedef {Object} ChoixArticle
 * @property {string} issue   `choisi` | `inconnu` | `ambigu` | `vide`.
 * @property {boolean} ok     true UNIQUEMENT si la ligne est saisissable.
 * @property {string} nom     libellé de catalogue à envoyer ('' sinon).
 * @property {Array<*>} fiches fiches en cause (2+ si ambigu).
 * @property {string} message phrase française ('' si ok ou vide).
 */

/**
 * Verdict sur ce que porte la ligne — la seule fonction qui décide.
 *
 * ⚠️ `ambigu` n'est PAS `ok`. Le bon transporte un NOM : deux fiches actives
 * de même identité sont indiscernables une fois le bon envoyé, et le serveur
 * refuse (`identiteArticle`, code `article_ambigu`). Accepter ici
 * remplacerait une saisie libre par un choix ambigu — pas un progrès. Le
 * remède est une FUSION, et le message le dit.
 *
 * @param {{entrees?: Array<EntreeCatalogue>, parCle?: Object<string, EntreeCatalogue>}} index
 *   L'index COMPLET de construireIndex : `parCle` pour l'identité exacte, et
 *   `entrees` que le repli `filtrerEntrees` parcourt.
 * @param {*} saisie
 * @returns {ChoixArticle}
 */
function verdictChoix(index, saisie) {
  var brut = saisie === null || saisie === undefined ? '' : String(saisie).trim();
  if (!brut) {
    return { issue: ISSUE_VIDE, ok: false, nom: '', fiches: [], message: '' };
  }
  var parCle = (index && index.parCle) || {};
  var e = parCle[cleIdentite(brut)];
  if (!e) {
    // ⚠️ AVANT de déclarer l'article inconnu : reste-t-il des candidats ?
    // C'est toute la différence entre « tu tapes, continue » et « cet
    // article n'existe pas, fais-le créer ». Les confondre proposait la
    // création sur `sulfate` alors que neuf « Sulfate … » existent.
    var candidats = filtrerEntrees(index, brut, 1);
    if (candidats.length) {
      var n = filtrerEntrees(index, brut, 500).length;
      return {
        issue: ISSUE_EN_COURS, ok: false, nom: '', fiches: [],
        message: '« ' + brut + ' » n\'est pas un article : choisissez-en un dans la liste ('
          + n + (n > 1 ? ' correspondent' : ' correspond') + ').',
      };
    }
    return {
      issue: ISSUE_INCONNU, ok: false, nom: '', fiches: [],
      message: 'Aucun article du catalogue ne correspond à « ' + brut + ' ». '
        + 'Vérifiez l\'orthographe, ou demandez sa création au DG.',
    };
  }
  if (e.ambigu) {
    var noms = e.fiches.map(function (f) {
      return '« ' + String(f.nom === null || f.nom === undefined ? '' : f.nom) + ' » (' + String(f.id) + ')';
    }).join(' et ');
    return {
      issue: ISSUE_AMBIGU, ok: false, nom: e.nom, fiches: e.fiches.slice(),
      message: '« ' + e.nom + ' » correspond à ' + e.fiches.length
        + ' fiches actives du catalogue : ' + noms
        + '. Fusionnez-les avant de saisir ce bon — le stock ne peut pas être '
        + 'tenu sous deux identités.',
    };
  }
  return { issue: ISSUE_CHOISI, ok: true, nom: e.nom, fiches: e.fiches.slice(), message: '' };
}

/**
 * Lignes du bon qui ne désignent pas un article valide.
 *
 * Sert au bouton d'envoi : le front refuse AVANT l'appel réseau, avec le même
 * verdict que le serveur rendrait. Les lignes VIDES sont ignorées — elles
 * sont filtrées à la soumission comme aujourd'hui.
 *
 * @param {Array<*>} items lignes du formulaire (champ `article`).
 * @param {*} index
 * @returns {Array<{index: number, article: string, message: string, issue: string}>}
 */
function lignesInvalides(items, index) {
  var liste = Array.isArray(items) ? items : [];
  var out = [];
  for (var i = 0; i < liste.length; i++) {
    var it = liste[i] || {};
    var v = verdictChoix(index, it.article);
    if (v.issue === ISSUE_VIDE || v.ok) continue;
    out.push({
      index: i,
      article: String(it.article === null || it.article === undefined ? '' : it.article).trim(),
      message: v.message,
      issue: v.issue,
    });
  }
  return out;
}

export { cleIdentite, cleRecherche, ficheChoisissable, indexerCatalogue, filtrerEntrees, verdictChoix, lignesInvalides, ISSUE_CHOISI, ISSUE_EN_COURS, ISSUE_INCONNU, ISSUE_AMBIGU, ISSUE_VIDE };
