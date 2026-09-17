/*
 * lecturePaieExcel.js — lecture du FICHIER DE PAIE de quinzaine. PURE.
 *
 * Le fichier Excel est la SOURCE DE VÉRITÉ : c'est lui qui sert à payer. Ce
 * module en extrait les postes de coût pour les confronter à l'écran Quinzaine
 * et à l'écran Campagne.
 *
 * ── CHARGÉ DES DEUX CÔTÉS ──────────────────────────────────────────────────
 * Source : `src/modules/shared/lib/lecturePaieExcel.js` (module ES).
 * `functions/lib/paie/` en porte une copie CommonJS, imposée par le
 * déploiement : Firebase ne publie que `functions/`, et un `require('../../src/…')`
 * fait crasher TOUTES les Cloud Functions du fichier au chargement, sans
 * qu'aucun test local ne le voie (mémoire projet `backend-jamais-require-public`).
 * Un test de parité compare le code de chaque fonction ; s'il tombe, on
 * recopie la source.
 *
 * ── AUCUNE I/O ─────────────────────────────────────────────────────────────
 * Les fonctions prennent une GRILLE de cellules (tableau de tableaux), jamais
 * un chemin de fichier. L'appelant lit le classeur et passe les grilles. C'est
 * ce qui rend le module testable sans fixture binaire — un test peut décrire en
 * dix lignes une feuille au format exact du piège qu'il vérifie — et c'est ce
 * qui permettra au module in-app (Lot 3) de le réutiliser tel quel avec un
 * fichier déposé dans le navigateur.
 *
 * ── LES CINQ PIÈGES, ET CE QU'ILS COÛTENT ──────────────────────────────────
 * Tous rencontrés le 2026-08-22. Chacun a produit un résultat FAUX ET
 * PLAUSIBLE — c'est-à-dire le seul genre qu'on ne repère pas en le regardant.
 *
 * 1. LIGNE DE TOTAL en bas de feuille : son « Matricule » est du texte, mais
 *    son « Montant Brut » est bien numérique. L'inclure double EXACTEMENT
 *    chaque somme. Constaté : 1 484 journées lues 2 968.
 *
 * 2. COLONNES DÉCALÉES : 15 ou 16 colonnes de jours selon la quinzaine. La 2ᵉ
 *    quinzaine de juillet décale tout d'un cran. Un index en dur y lit « Total »
 *    à la place de « Prime ancienneté », et fait conclure que les non-déclarés
 *    touchent de l'ancienneté — ils n'en touchent pas. D'où : repérage PAR
 *    EN-TÊTE, jamais par position.
 *
 * 3. LA FEUILLE PORTE SES PROPRES TOTAUX (« Total des places », « Montant
 *    Total » sur TRANSPORT). Les recalculer en sommant « tout ce qui est à
 *    droite » ré-additionne ces colonnes : 849 475 DH de transport au lieu de
 *    26 325. On lit la colonne de total, on ne la refait pas.
 *
 * 4. MATRICULES : le registre Smart Berry est keyé NUMÉRIQUE. On normalise donc
 *    ici aussi, sans quoi aucun rapprochement nominatif ne tombe juste.
 *
 * 5. « PRIME FONCTION BRUT » N'EST PAS QUE LA PRIME DE FONCTION : elle agrège
 *    prime de fonction, heures sup et prime de traitement (détail dans la
 *    feuille « Prime General »). La comparer à notre seule prime de fonction,
 *    c'est comparer un poste à trois.
 *
 * (Le sixième piège n'est pas ici mais dans l'appelant : macOS encode les noms
 * de fichiers en NFD. Un test `/2éme/` écrit en NFC ne matche pas le nom réel.
 * D'où `periodeDeGrille` : la quinzaine se lit DANS la feuille, jamais dans le
 * nom du fichier.)
 */
// @ts-check

/**
 * Normalise un libellé d'en-tête pour la comparaison. PURE.
 *
 * Les en-têtes du fichier portent des espaces multiples et finaux
 * (« Prime ancienneté   », « Montant  Net »). Comparer les chaînes brutes
 * échouerait sur des différences invisibles à l'œil.
 *
 * @param {*} v
 * @returns {string}
 */
function normaliserLibelle(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Clé de rapprochement d'un matricule. PURE.
 *
 * Mêmes règles que `cleRegistre` (coutOuvrierCampagne) et `numKey` (QuinzaineTab) :
 * chiffres seulement. Une normalisation différente ici rendrait le
 * rapprochement nominatif systématiquement vide.
 *
 * @param {*} v
 * @returns {string}
 */
function cleMatricule(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[^0-9]/g, '');
}

/**
 * Dit si une valeur de cellule est un nombre exploitable. PURE.
 *
 * Exclut `NaN` et l'infini : une cellule corrompue vaut 0, jamais un total
 * incalculable qui se propagerait en `NaN` dans toute la ligne.
 *
 * @param {*} v
 * @returns {boolean}
 */
function estNombre(v) {
  return typeof v === 'number' && isFinite(v);
}

/** @param {*} v @returns {number} */
function nombre(v) {
  return estNombre(v) ? v : 0;
}

/**
 * Localise la ligne d'en-tête et l'index de ses colonnes. PURE.
 *
 * Cherche la ligne portant `ancre` (« matricule », « personnel »…) dans les
 * `profondeur` premières lignes : les feuilles ont un bandeau de titre de
 * hauteur variable au-dessus du tableau.
 *
 * @param {Array<Array<*>>} grille
 * @param {string} ancre libellé normalisé attendu dans la ligne d'en-tête.
 * @param {number} [profondeur] lignes à inspecter (défaut 12).
 * @returns {{ligne: number, index: Object<string, number>}|null} `ligne` est
 *   l'index 0-based de l'en-tête ; `null` si introuvable.
 */
function trouverEnTete(grille, ancre, profondeur) {
  const g = Array.isArray(grille) ? grille : [];
  const max = Math.min(g.length, profondeur || 12);
  const cible = normaliserLibelle(ancre);
  for (let i = 0; i < max; i++) {
    const ligne = Array.isArray(g[i]) ? g[i] : [];
    if (!ligne.some((c) => normaliserLibelle(c) === cible)) continue;
    const index = {};
    ligne.forEach((c, j) => {
      const k = normaliserLibelle(c);
      // PREMIÈRE occurrence retenue : certaines feuilles portent un second
      // tableau à droite. Garder la dernière ferait lire les colonnes du
      // mauvais tableau, sans rien signaler.
      if (k && !(k in index)) index[k] = j;
    });
    return { ligne: i, index };
  }
  return null;
}

/**
 * Résout une colonne parmi plusieurs libellés possibles. PURE.
 *
 * Le fichier écrit « Montant  Net » (deux espaces) sur certaines feuilles et
 * « Montant Net » sur d'autres — après normalisation les deux se réduisent au
 * même libellé, mais d'autres variantes subsistent d'une quinzaine à l'autre.
 *
 * @param {Object<string, number>} index
 * @param {...string} libelles
 * @returns {number|null}
 */
function colonne(index, ...libelles) {
  const idx = index || {};
  for (const l of libelles) {
    const k = normaliserLibelle(l);
    if (k in idx) return idx[k];
  }
  return null;
}

/**
 * Dit si une ligne est une LIGNE DE TOTAL, à exclure. PURE.
 *
 * Le piège n°1. Le « Matricule » d'une ligne de total est du texte (« Total »,
 * « TOTAL GENERAL », une cellule vide fusionnée), tandis que ses montants sont
 * numériques comme ceux d'un ouvrier. L'inclure double exactement chaque somme,
 * et le résultat reste crédible.
 *
 * Règle : un matricule d'ouvrier ne contient QUE des chiffres (éventuellement
 * décoré d'espaces ou d'un point décimal par Excel).
 *
 * @param {*} matricule
 * @returns {boolean}
 */
function estLigneTotal(matricule) {
  const brut = String(matricule === null || matricule === undefined ? '' : matricule).trim();
  if (!brut) return true;
  if (!cleMatricule(brut)) return true;
  return !/^\d+(?:[.,]0+)?$/.test(brut);
}

/**
 * Lit une feuille d'ouvriers (`POINTAGE` ou `SANS CNSS`). PURE.
 *
 * @param {Array<Array<*>>} grille
 * @returns {Array<{matricule: string, matriculeBrut: string, base: number,
 *   feries: number, jours: number, anciennete: number, primeFonctionBrut: number,
 *   montantBrut: number, montantNet: number, equipe: string}>}
 */
function lireFeuilleOuvriers(grille) {
  const en = trouverEnTete(grille, 'matricule');
  if (!en) return [];
  const idx = en.index;
  const cMat = colonne(idx, 'matricule');
  const cBrut = colonne(idx, 'montant brut');
  if (cMat === null || cBrut === null) return [];
  const c = {
    base: colonne(idx, 'salaire de base brut', 'salaire de base'),
    feries: colonne(idx, 'jour férié', 'jours fériés'),
    jours: colonne(idx, 'nbr jour travail', 'nbr jours travail'),
    anc: colonne(idx, 'prime ancienneté'),
    pf: colonne(idx, 'prime fonction brut', 'prime fonction'),
    net: colonne(idx, 'montant net'),
    equipe: colonne(idx, "nom d'equipe", "nom d'équipe"),
  };
  const g = Array.isArray(grille) ? grille : [];
  const out = [];
  for (let i = en.ligne + 1; i < g.length; i++) {
    const r = Array.isArray(g[i]) ? g[i] : [];
    const mat = r[cMat];
    // Un montant non numérique = ligne décorative (séparateur, sous-titre).
    if (!estNombre(r[cBrut])) continue;
    if (estLigneTotal(mat)) continue;
    const lire = (k) => (c[k] === null ? 0 : nombre(r[c[k]]));
    out.push({
      matricule: cleMatricule(mat),
      matriculeBrut: String(mat).trim(),
      base: lire('base'),
      feries: lire('feries'),
      jours: lire('jours'),
      anciennete: lire('anc'),
      // ⚠️ Piège n°5 : ce champ agrège prime de fonction + heures sup + prime
      // de traitement. Le nom vient du fichier, pas de nous — on le garde tel
      // quel pour que personne ne le confonde avec notre `primeFonction`.
      primeFonctionBrut: lire('pf'),
      montantBrut: nombre(r[cBrut]),
      montantNet: lire('net'),
      equipe: c.equipe === null ? '' : String(r[c.equipe] || '').trim(),
    });
  }
  return out;
}

/**
 * Période couverte par une feuille, lue DANS la feuille. PURE.
 *
 * Le bandeau porte « Quinzaine : Du 01/07/2026 Au 15/07/2026 ». On ne déduit
 * JAMAIS la quinzaine du nom de fichier : macOS encode les accents en NFD, et
 * un test écrit en NFC ne matche pas — deux quinzaines interverties, sans que
 * rien ne le signale (constaté le 2026-08-21).
 *
 * @param {Array<Array<*>>} grille
 * @param {number} [profondeur] lignes de bandeau à inspecter (défaut 8).
 * @returns {{debut: string, fin: string}|null} dates ISO.
 */
function periodeDeGrille(grille, profondeur) {
  const g = Array.isArray(grille) ? grille : [];
  const max = Math.min(g.length, profondeur || 8);
  const re = /(\d{2})\/(\d{2})\/(\d{4})\D+(\d{2})\/(\d{2})\/(\d{4})/;
  for (let i = 0; i < max; i++) {
    const ligne = Array.isArray(g[i]) ? g[i] : [];
    for (const c of ligne) {
      const m = String(c === null || c === undefined ? '' : c).match(re);
      if (m) {
        return {
          debut: m[3] + '-' + m[2] + '-' + m[1],
          fin: m[6] + '-' + m[5] + '-' + m[4],
        };
      }
    }
  }
  return null;
}

/**
 * Lit la feuille `TRANSPORT`. PURE.
 *
 * Piège n°3 : la feuille porte « Total des places » et « Montant Total » par
 * équipe. On les LIT. Recalculer en sommant les colonnes à droite du tarif
 * ré-additionne ces totaux — 849 475 DH au lieu de 26 325, soit trente fois le
 * montant réel, et pourtant aucune erreur levée.
 *
 * @param {Array<Array<*>>} grille
 * @returns {{total: number, places: number,
 *   equipes: Array<{equipe: string, tarif: number, places: number, montant: number}>}}
 */
function lireTransport(grille) {
  const en = trouverEnTete(grille, 'personnel');
  const vide = { total: 0, places: 0, equipes: [] };
  if (!en) return vide;
  const cMontant = colonne(en.index, 'montant total');
  const cPlaces = colonne(en.index, 'total des places');
  const cTarif = colonne(en.index, 'salaire de base', 'salaire de base brut');
  if (cMontant === null) return vide;
  const g = Array.isArray(grille) ? grille : [];
  const out = { total: 0, places: 0, equipes: [] };
  for (let i = en.ligne + 1; i < g.length; i++) {
    const r = Array.isArray(g[i]) ? g[i] : [];
    const nom = String(r[0] === null || r[0] === undefined ? '' : r[0]).trim();
    if (!nom || !estNombre(r[cMontant])) continue;
    // Une ligne de total récapitule les équipes. Le fichier l'intitule « Total »,
    // « Totaux » ou « Total en Dirham » selon la feuille — d'où le préfixe et
    // non une liste fermée, qu'une variante de plus prendrait en défaut.
    if (/^tota/i.test(nom)) continue;
    const e = {
      equipe: nom,
      tarif: cTarif === null ? 0 : nombre(r[cTarif]),
      places: cPlaces === null ? 0 : nombre(r[cPlaces]),
      montant: nombre(r[cMontant]),
    };
    out.equipes.push(e);
    out.total += e.montant;
    out.places += e.places;
  }
  return out;
}

/**
 * Lit la feuille « TRSP MARCHANDISE & Divers » — la SOUS-TRAITANCE. PURE.
 *
 * Tracteurs, chargements, nettoyages : des prestataires, sans bulletin de
 * paie. Le fichier les tient sur une feuille à part, avec sa propre ligne
 * « Total en Dirham ».
 *
 * ⚠️ Cette feuille EXISTE, contrairement à ce que l'écran de rapprochement a
 * d'abord affirmé (2026-08-22). Il servait « — » côté fichier et empruntait le
 * montant de Smart Berry pour composer le total du fichier : le résultat
 * tombait juste — les deux valeurs coïncident sur les trois quinzaines — mais
 * un chiffre emprunté à celui qu'on contrôle ne contrôle plus rien.
 *
 * Comme TRANSPORT, la feuille porte SES totaux : « Montant Total » par ligne,
 * et une ligne « Total en Dirham ». On les lit, on ne les recalcule pas. Sa
 * colonne de total se déplace selon le nombre de jours (21 ou 22) — d'où le
 * repérage par en-tête.
 *
 * @param {Array<Array<*>>} grille
 * @returns {{total: number, lignes: Array<Object>}}
 */
function lireDivers(grille) {
  const en = trouverEnTete(grille, 'bénéficiaire') || trouverEnTete(grille, 'beneficiaire');
  if (!en) return { total: 0, lignes: [] };
  const cMontant = colonne(en.index, 'montant total');
  if (cMontant === null) return { total: 0, lignes: [] };
  const c = {
    prix: colonne(en.index, 'prix unitaire'),
    fonction: colonne(en.index, 'fonction'),
    tache: colonne(en.index, 'tache', 'tâche'),
    qte: colonne(en.index, 'total'),
  };
  const g = Array.isArray(grille) ? grille : [];
  const out = { total: 0, lignes: [] };
  for (let i = en.ligne + 1; i < g.length; i++) {
    const r = Array.isArray(g[i]) ? g[i] : [];
    const nom = String(r[0] === null || r[0] === undefined ? '' : r[0]).trim();
    if (!nom || !estNombre(r[cMontant])) continue;
    // « Total en Dirham » : même règle que TRANSPORT — un préfixe, et non une
    // liste fermée qu'une variante de plus prendrait en défaut.
    if (/^tota/i.test(nom)) continue;
    const l = {
      beneficiaire: nom,
      fonction: c.fonction === null ? '' : String(r[c.fonction] || '').trim(),
      tache: c.tache === null ? '' : String(r[c.tache] || '').trim(),
      prixUnitaire: c.prix === null ? 0 : nombre(r[c.prix]),
      quantite: c.qte === null ? 0 : nombre(r[c.qte]),
      montant: nombre(r[cMontant]),
    };
    out.lignes.push(l);
    out.total += l.montant;
  }
  return out;
}

/**
 * Agrège les lignes d'une feuille d'ouvriers. PURE.
 *
 * @param {Array<Object>} lignes sortie de `lireFeuilleOuvriers`.
 * @returns {{effectif: number, jours: number, feries: number, anciennete: number,
 *   primeFonctionBrut: number, brut: number, net: number}}
 */
function agregerOuvriers(lignes) {
  const out = { effectif: 0, jours: 0, feries: 0, anciennete: 0,
    primeFonctionBrut: 0, brut: 0, net: 0 };
  (lignes || []).forEach((l) => {
    if (!l) return;
    out.effectif += 1;
    out.jours += nombre(l.jours);
    out.feries += nombre(l.feries);
    out.anciennete += nombre(l.anciennete);
    out.primeFonctionBrut += nombre(l.primeFonctionBrut);
    out.brut += nombre(l.montantBrut);
    out.net += nombre(l.montantNet);
  });
  return out;
}

/**
 * Postes de coût d'une quinzaine, tels que le FICHIER les donne. PURE.
 *
 * Sépare trois populations que le fichier mélange sur deux feuilles :
 *   - déclarés PURS (POINTAGE seulement) ;
 *   - non déclarés PURS (SANS CNSS seulement) ;
 *   - MIXTES, présents sur les deux — une partie des journées déclarée, l'autre
 *     non. Smart Berry, lui, attribue un statut UNIQUE par ouvrier et par
 *     quinzaine : c'est une divergence de modèle, pas un détail, et elle doit
 *     être comptée pour être arbitrée. Constaté : 17, 13 et 20 ouvriers selon
 *     la quinzaine.
 *
 * @param {Object} args
 * @param {Array<Object>} args.pointage lignes de la feuille POINTAGE.
 * @param {Array<Object>} args.sansCnss lignes de la feuille SANS CNSS.
 * @param {{total?: number, places?: number}} [args.transport]
 * @returns {Object}
 */
function postesExcel(args) {
  /** @type {any} */ // le `|| {}` defensif efface la forme documentee par le @param ci-dessus
  const a = args || {};
  const P = a.pointage || [];
  const S = a.sansCnss || [];
  const transport = a.transport || { total: 0, places: 0 };

  const matsP = new Set(P.map((l) => l.matricule).filter(Boolean));
  const matsS = new Set(S.map((l) => l.matricule).filter(Boolean));
  const mixtes = [...matsP].filter((m) => matsS.has(m)).sort();

  const aP = agregerOuvriers(P);
  const aS = agregerOuvriers(S);

  return {
    declares: aP,
    nonDeclares: aS,
    mixtes: mixtes,
    // Effectifs PURS : ce sont eux qui se comparent à la ventilation
    // déclaré/non-déclaré de Smart Berry ; les mixtes n'entrent dans aucune des
    // deux et doivent se compter à part.
    effectifDeclaresPurs: matsP.size - mixtes.length,
    effectifNonDeclaresPurs: matsS.size - mixtes.length,
    jours: aP.jours + aS.jours,
    feries: aP.feries + aS.feries,
    anciennete: aP.anciennete + aS.anciennete,
    primeFonctionBrut: aP.primeFonctionBrut + aS.primeFonctionBrut,
    brut: aP.brut + aS.brut,
    // LE chiffre de référence : c'est lui que totalise la feuille VIREMENT et
    // c'est lui qui sort de la caisse.
    net: aP.net + aS.net,
    transport: nombre(transport.total),
    placesTransport: nombre(transport.places),
    // `null` quand la feuille n'a pas été fournie : un 0 se lirait « aucune
    // sous-traitance cette quinzaine », ce qui n'est pas « je n'ai pas lu
    // cette feuille ».
    sousTraitance: a.divers ? nombre(a.divers.total) : null,
    lignesSousTraitance: (a.divers && a.divers.lignes) || [],
  };
}

export { normaliserLibelle, cleMatricule, estNombre, estLigneTotal, trouverEnTete, colonne, lireFeuilleOuvriers, periodeDeGrille, lireTransport, lireDivers, agregerOuvriers, postesExcel };
