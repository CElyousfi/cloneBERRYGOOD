/*
 * rapprochementPaie.js — FICHIER DE PAIE ↔ écran Quinzaine. PURE, aucune I/O.
 *
 * Le fichier Excel est la source de vérité : c'est lui qui sert à payer. Ce
 * module met ses postes face à ceux de l'écran Quinzaine et dit OÙ ils
 * divergent — pas seulement de combien.
 *
 * ── COMPARER CE QUI EST COMPARABLE ─────────────────────────────────────────
 * Les deux sources ne découpent pas le coût de la même façon. Le fichier range
 * le jour férié DANS le montant de l'ouvrier ; l'écran Quinzaine en fait une
 * ligne d'« Autres Primes ». Le fichier ignore la sous-traitance ; l'écran
 * l'ajoute au net à payer.
 *
 * On ne compare donc QUE des périmètres reconstitués explicitement — et on le
 * dit dans le libellé de chaque ligne. Mettre côte à côte le « NET » du fichier
 * (153 503) et le « Net à payer » de l'écran (187 737) fabrique un écart de
 * 34 000 DH qui n'existe pas : c'est arrivé le 2026-08-22, et il a fallu une
 * demi-journée pour établir que les deux chiffres ne parlaient pas de la même
 * chose.
 *
 * ── UN ÉCART N'EST PAS FORCÉMENT UNE ERREUR DE CALCUL ──────────────────────
 * Le pointage BEE ONE et la feuille de paie peuvent être en désaccord sur une
 * PRÉSENCE : 39 ouvriers pointés le 14/08 quand la paie en paie 72. Aucun code
 * ne tranche ça. Le rapport distingue donc explicitement ce qui relève du
 * CALCUL (corrigeable) et ce qui relève des DONNÉES (à arbitrer).
 */
// @ts-check

/** @param {*} v @returns {number} */
function nombre(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

/**
 * Valeur du jour férié côté FICHIER, en dirhams nets. PURE.
 *
 * Le fichier ne l'isole pas : il l'ajoute au « Total » de l'ouvrier, qui part
 * ensuite dans le Montant Brut puis dans le Net. On le reconstitue donc au
 * SMAG, comme la paie le fait : `jours × SMAG brut × (1 − retenue)`.
 *
 * C'est une reconstitution, pas une lecture — le rapport doit le dire, sans
 * quoi on la prendrait pour une valeur du fichier.
 *
 * @param {number} joursFeries
 * @param {{smagBrutJournalier?: number, tauxCnssSalariale?: number, tauxAmo?: number}} baremes
 * @returns {number}
 */
function valeurFerieFichier(joursFeries, baremes) {
  var b = baremes || {};
  var smag = nombre(b.smagBrutJournalier);
  var retenue = 1 - (nombre(b.tauxCnssSalariale) + nombre(b.tauxAmo));
  return nombre(joursFeries) * smag * retenue;
}

/**
 * Une ligne de comparaison. PURE.
 *
 * `nature` porte l'information la plus utile du rapport : un écart de CALCUL
 * se corrige dans Smart Berry, un écart de DONNÉES se tranche avec le RH. Les
 * confondre fait chercher un bug là où il y a un désaccord sur une présence.
 *
 * @param {string} cle
 * @param {string} libelle
 * @param {number|null} fichier
 * @param {number|null} smartBerry
 * @param {{unite?: string, nature?: string, note?: string}} [opts]
 */
function ligne(cle, libelle, fichier, smartBerry, opts) {
  var o = opts || {};
  var ecart = (fichier === null || smartBerry === null)
    ? null : nombre(fichier) - nombre(smartBerry);
  return {
    cle: cle,
    libelle: libelle,
    fichier: fichier === null ? null : nombre(fichier),
    smartBerry: smartBerry === null ? null : nombre(smartBerry),
    ecart: ecart,
    unite: o.unite || 'DH',
    // 'calcul'    → Smart Berry se corrige ;
    // 'donnees'   → les deux sources sont en désaccord, arbitrage RH ;
    // 'perimetre' → les deux ne couvrent pas la même chose, à reconstituer ;
    // 'info'      → servi pour lecture, pas un écart.
    nature: o.nature || 'calcul',
    note: o.note || '',
  };
}

/**
 * Rapproche un fichier de paie et un instantané de l'écran Quinzaine. PURE.
 *
 * @param {Object} args
 * @param {Object} args.fichier sortie de `LecturePaieExcel.postesExcel`.
 * @param {Object} args.quinzaine instantané `rh_cout_quinzaine`.
 * @param {Object} [args.baremes] barèmes de paie, pour reconstituer le férié.
 * @returns {{lignes: Array<Object>, total: Object, alertes: Array<Object>,
 *   comparable: boolean}}
 */
function comparer(args) {
  /** @type {any} */ // le `|| {}` defensif efface la forme documentee par le @param ci-dessus
  var a = args || {};
  var f = a.fichier;
  var q = a.quinzaine;
  if (!f || !q) {
    return { lignes: [], total: null, alertes: [], comparable: false };
  }
  var postes = q.postes || {};
  var sous = q.sousPostes || {};
  var transportSB = nombre(postes.primeTransport);
  var locationSB = nombre(postes.locationEngins);

  // Salaires NETS, des deux côtés, hors transport et hors sous-traitance.
  // C'est le seul périmètre que les deux sources couvrent à l'identique.
  var salairesSB = nombre(q.netAPayer) - transportSB - locationSB;

  var lignes = [
    ligne('jh', 'Journées-homme (JH)', f.jours, q.jours,
      { unite: 'JH', nature: 'perimetre',
        note: 'Un écart ici précède tous les autres : deux totaux qui ne '
          + 'portent pas sur les mêmes journées ne se comparent pas.' }),

    // LA ligne qui a motivé ce module.
    ligne('joursFeries', 'Jours fériés — nombre de journées',
      f.feries, q.joursFeries === undefined ? null : nombre(q.joursFeries),
      { unite: 'j', nature: 'donnees',
        note: 'Le pointage BEE ONE et la feuille de paie peuvent être en '
          + 'désaccord sur qui était présent un jour férié. Cela ne se corrige '
          + 'pas dans Smart Berry : c\'est un arbitrage RH.' }),

    // JOUR FÉRIÉ — INDICATIF, et non un écart.
    //
    // Les deux colonnes ne couvrent pas les mêmes composants : côté fichier on
    // reconstitue au SMAG NU, faute de pouvoir isoler la part de férié dans le
    // montant de l'ouvrier ; côté Smart Berry le montant porte AUSSI
    // l'ancienneté et la prime de fonction de ces journées.
    //
    // Constaté sur la Quinzaine 02 : 90,9 DH/jour d'un côté, 104,8 de l'autre.
    // Les soustraire donnait −927 DH qui ne mesuraient rien — et gonflaient
    // l'alerte « hors jour férié » à 1 308 DH pour un résidu réel de 294.
    //
    // Le férié est de toute façon DÉJÀ dans la ligne « Salaires nets » des deux
    // côtés : cette ligne n'a jamais eu à entrer dans le total, seulement à
    // renseigner.
    ligne('ferieDH', 'Jour férié — montant (indicatif)',
      valeurFerieFichier(f.feries, a.baremes),
      sous.jourFerie === undefined ? null : nombre(sous.jourFerie),
      { nature: 'info',
        note: 'NON COMPARABLE terme à terme : côté fichier, reconstitué au SMAG '
          + 'nu ; côté Smart Berry, ancienneté et prime de fonction de ces '
          + 'journées comprises. Le férié est déjà dans les salaires nets des '
          + 'deux côtés.' }),

    ligne('salaires', 'Salaires nets (hors transport et sous-traitance)',
      f.net, salairesSB, { nature: 'calcul' }),

    ligne('transport', 'Prime de transport', f.transport, transportSB,
      { nature: 'calcul' }),

    // SOUS-TRAITANCE. Le fichier la porte sur sa feuille « TRSP MARCHANDISE &
    // Divers » — contrairement à ce que cet écran a d'abord affirmé. Il
    // servait « — » et EMPRUNTAIT le montant de Smart Berry pour composer le
    // total du fichier : le résultat tombait juste (les deux coïncident sur
    // les trois quinzaines) mais un chiffre emprunté à celui qu'on contrôle
    // ne contrôle plus rien.
    //
    // `null` = feuille non lue (ancien fichier, autre format). On retombe
    // alors sur Smart Berry pour ne pas casser le total, et on le DIT.
    ligne('location', f.sousTraitance === null || f.sousTraitance === undefined
      ? 'Location & Engins (sous-traitance) — non lue dans le fichier'
      : 'Location & Engins (sous-traitance)',
      (f.sousTraitance === null || f.sousTraitance === undefined) ? null : f.sousTraitance,
      locationSB,
      (f.sousTraitance === null || f.sousTraitance === undefined)
        ? { nature: 'info',
          note: 'Feuille « TRSP MARCHANDISE & Divers » absente ou illisible : le '
            + 'total du fichier reprend le montant Smart Berry, faute de mieux.' }
        : { nature: 'calcul',
          note: 'Lue dans la feuille « TRSP MARCHANDISE & Divers » du fichier.' }),
  ];

  // TOTAL DÉCAISSÉ — périmètre reconstitué des deux côtés, explicitement.
  // La sous-traitance vient du FICHIER quand il la porte. À défaut seulement,
  // on emprunte celle de Smart Berry — sinon le total chuterait de plusieurs
  // milliers de dirhams et afficherait un écart qui n'existe pas.
  var locationFichier = (f.sousTraitance === null || f.sousTraitance === undefined)
    ? locationSB : nombre(f.sousTraitance);
  var totalFichier = nombre(f.net) + nombre(f.transport) + locationFichier;
  var totalSB = nombre(q.netAPayer);
  var total = {
    libelle: 'TOTAL décaissé (salaires + transport + sous-traitance)',
    fichier: totalFichier,
    smartBerry: totalSB,
    ecart: totalFichier - totalSB,
    ecartPct: totalFichier > 0 ? (totalFichier - totalSB) / totalFichier : null,
  };

  return {
    lignes: lignes,
    total: total,
    alertes: alertes(lignes, total),
    comparable: true,
  };
}

/**
 * Ce qu'il faut regarder en premier, et pourquoi. PURE.
 *
 * Un rapport qui se contente d'aligner des nombres oblige le lecteur à
 * refaire l'analyse à chaque fois. Ces alertes disent quoi faire — ou qu'il
 * n'y a rien à faire.
 *
 * @param {Array<Object>} lignes
 * @param {Object} total
 * @returns {Array<{niveau: string, texte: string}>}
 */
function alertes(lignes, total) {
  var out = [];
  var par = {};
  lignes.forEach(function (l) { par[l.cle] = l; });

  // 1) Le périmètre d'abord : sans lui, le reste ne veut rien dire.
  if (par.jh && par.jh.ecart !== null && Math.abs(par.jh.ecart) > 0.5) {
    out.push({ niveau: 'bloquant', texte:
      'Les journées ne concordent pas (' + Math.round(par.jh.ecart * 10) / 10
      + ' JH d\'écart). Régler ce point AVANT de regarder les montants : deux '
      + 'totaux qui ne portent pas sur les mêmes journées ne se comparent pas.' });
  }

  // 2) Les jours fériés : un désaccord de DONNÉES, pas un bug.
  if (par.joursFeries && par.joursFeries.ecart !== null
      && Math.abs(par.joursFeries.ecart) >= 1) {
    var d = Math.round(par.joursFeries.ecart);
    out.push({ niveau: 'arbitrage', texte:
      'Le fichier paie ' + (d > 0 ? d + ' journées fériées DE PLUS' : (-d) + ' journées fériées DE MOINS')
      + ' que le pointage BEE ONE n\'en enregistre. Les deux sources sont en '
      + 'désaccord sur des présences — aucun code ne tranche cela, c\'est une '
      + 'décision RH.' });
  }

  // 3) Le résidu. On ne RETRANCHE PLUS le férié : sa ligne n'est qu'indicative,
  //    les deux colonnes n'y couvrent pas les mêmes composants. Le soustraire
  //    gonflait le résidu — 1 308 DH annoncés pour 294 réels sur la
  //    Quinzaine 02.
  if (total && Math.abs(total.ecart) > Math.max(500, Math.abs(total.fichier) * 0.005)) {
    out.push({ niveau: 'calcul', texte:
      'Il reste ' + Math.round(total.ecart) + ' DH d\'écart sur le total '
      + 'décaissé. Celui-là relève du calcul Smart Berry.' });
  }

  if (!out.length) {
    out.push({ niveau: 'ok', texte:
      'Aucun écart significatif : le fichier et Smart Berry disent la même chose.' });
  }
  return out;
}

export { nombre, valeurFerieFichier, ligne, comparer, alertes };
