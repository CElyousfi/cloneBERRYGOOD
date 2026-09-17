// @ts-check

/**
 * FUSION EN MASSE des articles en doublon — logique PURE d'orchestration.
 *
 * ── CE QUE CE MODULE N'EST PAS ────────────────────────────────────────────
 * Il ne fusionne RIEN et ne décide RIEN sur les données. La mécanique de
 * fusion (réassignation des mouvements/BDC ouverts, agrégation atomique des
 * soldes, audit `article_merges` avec snapshot de rollback) vit dans l'action
 * `merge-articles` de functions/index.js, en production. Le choix de la fiche
 * maître vit dans `functions/lib/stockMerge/masterSuggestion.js`, seule règle
 * du dépôt. Ce module ne fait que ce que l'écran ne savait pas faire :
 * SÉLECTIONNER plusieurs groupes, CHIFFRER le lot avant d'écrire, et RENDRE
 * COMPTE de ce qui est passé et de ce qui ne l'est pas.
 *
 * Omar a traité 20 groupes à l'unité ; il en reste 85 (mesure production du
 * 2026-08-27 : 85 groupes, 85 décidables, 86 fiches à désactiver, 52 groupes
 * portant au moins un solde — 189 documents `stock_balances` agrégés).
 * Le problème est le VOLUME, pas la mécanique : on n'y touche pas.
 *
 * ── FAIL-CLOSED SUR LA SÉLECTION ──────────────────────────────────────────
 * Un groupe dont le maître n'est pas déterminé (cascade indécidable, et Omar
 * n'a pas encore tranché à la main) n'est PAS sélectionnable. Une fusion en
 * masse qui devine un maître est exactement l'accident qu'on refuse : les
 * prix et l'historique d'achats ne sont pas transférés au maître, un mauvais
 * choix laisse un article actif non valorisable.
 *
 * ── APERÇU OBLIGATOIRE, ET LIÉ À LA SÉLECTION ─────────────────────────────
 * `signatureLot` fige le lot exact qui a été chiffré. Si la sélection change
 * après l'aperçu, la signature ne correspond plus et l'exécution doit être
 * réinterdite : sans ça, Omar validerait 3 groupes puis en fusionnerait 85.
 *
 * Aucune dépendance DOM/réseau : 100 % pur, testable unitairement.
 */

/**
 * @typedef {Object} EntreeLot
 * @property {string} normalized Clé du groupe (nom normalisé).
 * @property {string} master_ref docId de la fiche à CONSERVER.
 * @property {string[]} doublon_refs docId des fiches à absorber.
 */

/**
 * @typedef {Object} GroupeIgnore
 * @property {string} normalized
 * @property {string} raison Phrase française affichable telle quelle.
 */

/**
 * docId d'une fiche. JAMAIS le champ `reference`.
 *
 * ⚠️ `merge-articles` résout ses paramètres par
 * `collection("articles_catalog").doc(<clé>)` : la clé est le docId. En
 * production, 92 fiches ont un `reference` espacé que le docId n'a pas
 * (« ENG 0149 » vs « ENG0149 »), et 5 documents FANTÔMES sans `nom` ni
 * `active` existent justement à ces références espacées. Adresser par
 * `reference` fait atterrir la fusion sur le fantôme : les libellés de BDC et
 * de mouvements sont réécrits avec une chaîne vide pendant que la vraie fiche
 * reste active (cas réel « magical »). À l'échelle d'un lot de 85, l'erreur
 * n'est plus rattrapable à l'œil.
 *
 * @param {*} article
 * @returns {string}
 */
function docIdFiche(article) {
  if (!article) return '';
  return article.id == null ? '' : String(article.id);
}

/**
 * Le maître retenu pour un groupe : ce qu'Omar a coché à l'écran, et rien
 * d'autre. `mergeMasters` est déjà alimenté par la suggestion serveur pour les
 * groupes décidables, et laissé VIDE pour les autres (fail-closed amont).
 * @param {*} group
 * @param {Object<string,string>} masters normalized -> docId
 * @returns {string}
 */
function masterDuGroupe(group, masters) {
  if (!group || !group.normalized) return '';
  const m = (masters || {})[group.normalized];
  return m ? String(m) : '';
}

/**
 * Les doublons d'un groupe = toutes les fiches sauf le maître, par docId.
 * @param {*} group
 * @param {string} masterRef
 * @returns {string[]}
 */
function doublonsDuGroupe(group, masterRef) {
  const articles = (group && group.articles) || [];
  const refs = [];
  for (let i = 0; i < articles.length; i++) {
    const id = docIdFiche(articles[i]);
    if (id && id !== masterRef && refs.indexOf(id) === -1) refs.push(id);
  }
  return refs;
}

/**
 * Un groupe peut-il entrer dans une fusion EN MASSE ?
 *
 * Fail-closed : il faut un maître explicitement déterminé ET au moins un
 * doublon à absorber. Un groupe indécidable reste traitable À L'UNITÉ après
 * arbitrage manuel — il n'est simplement pas embarquable dans le lot.
 *
 * @param {*} group
 * @param {Object<string,string>} masters
 * @returns {boolean}
 */
function estSelectionnable(group, masters) {
  const masterRef = masterDuGroupe(group, masters);
  if (!masterRef) return false;
  return doublonsDuGroupe(group, masterRef).length > 0;
}

/**
 * Pourquoi un groupe n'est pas sélectionnable (phrase affichable).
 * @param {*} group
 * @param {Object<string,string>} masters
 * @returns {string} '' si le groupe est sélectionnable.
 */
function raisonNonSelectionnable(group, masters) {
  const masterRef = masterDuGroupe(group, masters);
  if (!masterRef) {
    const r = group && group.raison ? String(group.raison) : 'aucun maître déterminé';
    return 'aucun article à conserver n\'est déterminé (' + r + ') — choisissez-le pour inclure ce groupe';
  }
  if (doublonsDuGroupe(group, masterRef).length === 0) {
    return 'aucun doublon à absorber dans ce groupe';
  }
  return '';
}

/**
 * Les clés des groupes sélectionnables, dans l'ordre d'affichage.
 * @param {Array<*>} groups
 * @param {Object<string,string>} masters
 * @returns {string[]}
 */
function clesSelectionnables(groups, masters) {
  return (groups || [])
    .filter((g) => estSelectionnable(g, masters))
    .map((g) => String(g.normalized));
}

/**
 * Construit le LOT à fusionner à partir de la sélection d'Omar.
 *
 * Tout groupe coché mais non sélectionnable est ÉCARTÉ avec sa raison — il ne
 * fait pas échouer le lot, mais il ne part pas non plus en silence. Les
 * groupes non cochés ne sont pas des « ignorés » : ce sont des non-demandes.
 *
 * @param {Array<*>} groups
 * @param {Object<string,string>} masters
 * @param {Object<string,boolean>} selection normalized -> coché
 * @returns {{lot: EntreeLot[], ignores: GroupeIgnore[]}}
 */
function construireLot(groups, masters, selection) {
  const lot = [];
  const ignores = [];
  const sel = selection || {};
  for (const g of groups || []) {
    if (!g || !sel[g.normalized]) continue;
    const masterRef = masterDuGroupe(g, masters);
    const doublonRefs = doublonsDuGroupe(g, masterRef);
    if (!masterRef || doublonRefs.length === 0) {
      ignores.push({ normalized: String(g.normalized), raison: raisonNonSelectionnable(g, masters) });
      continue;
    }
    lot.push({ normalized: String(g.normalized), master_ref: masterRef, doublon_refs: doublonRefs });
  }
  return { lot, ignores };
}

/**
 * Empreinte du lot exact qui a été chiffré par l'aperçu.
 *
 * Sert à réinterdire l'exécution dès que la sélection ou un maître change :
 * un aperçu portant sur 3 groupes ne doit jamais autoriser la fusion de 85.
 * Le tri rend l'empreinte indépendante de l'ordre d'affichage.
 *
 * @param {EntreeLot[]} lot
 * @returns {string}
 */
function signatureLot(lot) {
  return (lot || [])
    .map((e) => e.normalized + '>' + e.master_ref + '<' + e.doublon_refs.slice().sort().join(','))
    .sort()
    .join('|');
}

/**
 * @typedef {Object} ApercuGlobal
 * @property {number} groupes
 * @property {number} fiches_desactivees
 * @property {number} soldes_agreges
 * @property {number} mouvements
 * @property {number} bdc
 */

/** @param {*} v @returns {number} */
function nombre(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
}

/**
 * Agrège les prévisualisations par groupe en UN chiffrage global.
 *
 * Les nombres viennent tous des réponses `merge-articles` en mode `preview` :
 * aucun n'est recalculé ici, sinon l'aperçu annoncerait autre chose que ce que
 * le serveur va faire.
 *
 * @param {Array<{doublon_refs: string[], preview: *}>} entrees
 * @returns {ApercuGlobal}
 */
function agregerApercu(entrees) {
  const total = { groupes: 0, fiches_desactivees: 0, soldes_agreges: 0, mouvements: 0, bdc: 0 };
  for (const e of entrees || []) {
    if (!e) continue;
    total.groupes++;
    total.fiches_desactivees += (e.doublon_refs || []).length;
    const p = e.preview || {};
    total.soldes_agreges += nombre(p.doublon_balances_count);
    total.mouvements += nombre(p.open_movements);
    total.bdc += nombre(p.open_bdc);
  }
  return total;
}

/**
 * @typedef {Object} RapportExecution
 * @property {number} groupes_fusionnes
 * @property {number} fiches_desactivees
 * @property {number} soldes_agreges
 * @property {number} mouvements
 * @property {number} bdc
 * @property {GroupeIgnore[]} non_fusionnes Groupes du lot qui ne sont PAS passés.
 * @property {boolean} arret_anomalie Le lot s'est-il arrêté sur une anomalie ?
 */

/**
 * Compte rendu final : ce qui est passé, ce qui ne l'est pas, et pourquoi.
 *
 * Une fusion en masse qui s'arrête à mi-parcours sans dire où en est le lot est
 * pire qu'un échec net : les 40 premières fusions sont acquises et Omar ne sait
 * pas lesquelles. Les groupes restés en attente APRÈS l'arrêt sont donc listés
 * eux aussi, au même titre que celui qui a échoué.
 *
 * @param {EntreeLot[]} lot Le lot tel qu'il devait être exécuté.
 * @param {Array<{normalized: string, ok: boolean, error?: string, counts?: *, doublon_refs?: string[]}>} resultats
 *   Résultats dans l'ordre d'exécution (peut être plus court que le lot en cas d'arrêt).
 * @param {GroupeIgnore[]} ignores Groupes écartés avant exécution.
 * @returns {RapportExecution}
 */
function resumerExecution(lot, resultats, ignores) {
  const rapport = {
    groupes_fusionnes: 0,
    fiches_desactivees: 0,
    soldes_agreges: 0,
    mouvements: 0,
    bdc: 0,
    non_fusionnes: (ignores || []).slice(),
    arret_anomalie: false,
  };
  const traites = {};
  for (const r of resultats || []) {
    if (!r) continue;
    traites[r.normalized] = true;
    if (r.ok) {
      rapport.groupes_fusionnes++;
      rapport.fiches_desactivees += (r.doublon_refs || []).length;
      const c = r.counts || {};
      rapport.soldes_agreges += nombre(c.balances);
      rapport.mouvements += nombre(c.movements);
      rapport.bdc += nombre(c.bdc);
    } else {
      rapport.arret_anomalie = true;
      rapport.non_fusionnes.push({
        normalized: r.normalized,
        raison: 'échec : ' + (r.error || 'erreur inconnue'),
      });
    }
  }
  if (rapport.arret_anomalie) {
    for (const e of lot || []) {
      if (!traites[e.normalized]) {
        rapport.non_fusionnes.push({
          normalized: e.normalized,
          raison: 'non traité — lot arrêté à la première anomalie',
        });
      }
    }
  }
  return rapport;
}

export { docIdFiche, masterDuGroupe, doublonsDuGroupe, estSelectionnable, raisonNonSelectionnable, clesSelectionnables, construireLot, signatureLot, agregerApercu, resumerExecution };
