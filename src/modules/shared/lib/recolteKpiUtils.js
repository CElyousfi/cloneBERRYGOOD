/**
 * recolteKpiUtils.js — Pure helpers for the "Coût Récolte" screen KPI cards.
 *
 * All functions are pure (no DOM, no network, no Firestore).
 *
 * Item « fix coût récolte : KPI suivent la période + fallback variété/culture » — 2026-06.
 *
 * Contexte BUG 2 : les KPI cards (Coût Net/Brut/Total, Total Kg, Ouvriers,
 * Coût Moyen/Ouvrier/Jour) doivent s'agréger sur la MÊME plage que le graphe
 * « Historique DH/Kg » (7/30/60/90 jours), pas seulement sur le jour courant.
 */
// @ts-check

/**
 * Agrège une série de jours (déjà agrégés par jour) en KPI de période.
 *
 * Chaque entrée de `daySeries` représente UN jour de la fenêtre sélectionnée,
 * avec ses coûts déjà calculés (salaire/transport/prime/charges) et le nombre
 * d'ouvrier-jours du jour (`nbOuvJour` = nb d'ouvriers distincts CE jour-là).
 *
 * - Coûts (salaire/transport/prime/charges) : SOMME sur la plage.
 * - Total Kg : SOMME sur la plage.
 * - coutMoyenOuvrierJour : moyenne PONDÉRÉE = somme des coûts / somme des
 *   (ouvrier×jour). PAS une moyenne de moyennes journalières.
 * - totalOuvrierJours : somme des nbOuvJour (dénominateur de la moyenne).
 * - nbJoursAvecDonnees : nombre de jours de la série qui portent des données
 *   réelles (kg>0 OU coût>0). Dénominateur des moyennes/jour (cf.
 *   `coutMoyenJour`, `kgMoyenJour`). Un jour totalement vide (typiquement
 *   « aujourd'hui » sans récolte saisie) n'est PAS compté afin de ne pas
 *   diluer les moyennes.
 * - coutMoyenJour / kgMoyenJour / salaireMoyenJour / ... : SOMME ÷
 *   nbJoursAvecDonnees. Utilisés par la vue PÉRIODE (30/7/60/90 j) où le DG
 *   veut des moyennes journalières et non des sommes cumulées.
 *
 * Le nombre d'ouvriers DISTINCTS sur la période n'est pas dérivable d'une
 * série déjà agrégée par jour ; il est fourni séparément par l'appelant
 * (cf. `distinctOuvriersFromRows`).
 *
 * BUG #pMBZlx03 (DH/kg période absurde ~190 DH) : en vue période, certaines
 * journées portent un coût mais kg=0 (ouvriers payés un jour sans récolte
 * enrichie). Si on divise (Σcoût toutes journées) ÷ (Σkg), ces « journées vides
 * de production » gonflent le numérateur sans contribuer au dénominateur → le
 * ratio explose. Consigne DG : « afficher une moyenne, ne pas tenir compte des
 * journées vides ». On ajoute donc des accumulateurs restreints aux JOURS DE
 * PRODUCTION (kg>0) et un champ `dhParKgBrutProd` = Σcoût(jours kg>0) ÷
 * Σkg(jours kg>0). `dhParKgBrut` (champ historique, division sur tous les jours)
 * est conservé inchangé pour ne casser aucun consommateur ; la vue période
 * consomme désormais `dhParKgBrutProd`.
 *
 * @param {Array<{salaire?:number, transport?:number, prime?:number, charges?:number, kg?:number, nbOuvJour?:number}>} daySeries
 * @returns {{
 *   totalSalaire:number, totalTransport:number, totalPrime:number, totalCharges:number,
 *   totalCout:number, totalKg:number, totalOuvrierJours:number, nbJoursAvecDonnees:number,
 *   dhParKgBrut:(number|null), dhParKgBrutProd:(number|null),
 *   totalCoutProd:number, totalKgProd:number, coutMoyenOuvrierJour:number,
 *   coutMoyenJour:number, kgMoyenJour:number,
 *   salaireMoyenJour:number, transportMoyenJour:number, primeMoyenJour:number, chargesMoyenJour:number
 * }}
 */
function aggregatePeriodKpis(daySeries) {
  const rows = Array.isArray(daySeries) ? daySeries : [];
  let totalSalaire = 0;
  let totalTransport = 0;
  let totalPrime = 0;
  let totalCharges = 0;
  let totalKg = 0;
  let totalOuvrierJours = 0;
  let nbJoursAvecDonnees = 0;
  // Accumulateurs restreints aux JOURS DE PRODUCTION (kg>0) — cf. BUG #pMBZlx03.
  let totalCoutProd = 0;
  let totalKgProd = 0;
  rows.forEach(function (d) {
    const sal = d.salaire || 0;
    const trans = d.transport || 0;
    const prm = d.prime || 0;
    const chg = d.charges || 0;
    const kg = d.kg || 0;
    totalSalaire += sal;
    totalTransport += trans;
    totalPrime += prm;
    totalCharges += chg;
    totalKg += kg;
    totalOuvrierJours += d.nbOuvJour || 0;
    // Jour « avec données » = au moins du kg OU un coût. Exclut un jour vide
    // (aujourd'hui sans récolte) du dénominateur des moyennes/jour.
    if (kg > 0 || sal > 0 || trans > 0 || prm > 0 || chg > 0) nbJoursAvecDonnees += 1;
    // Jour « de production » = kg>0. Seuls ces jours alimentent le DH/kg de
    // période (numérateur ET dénominateur), pour ne pas tenir compte des
    // journées cost-only qui font exploser le ratio.
    if (kg > 0) {
      totalCoutProd += sal + trans + prm + chg;
      totalKgProd += kg;
    }
  });
  const totalCout = totalSalaire + totalTransport + totalPrime + totalCharges;
  const dhParKgBrut = totalKg > 0 ? Math.round((totalCout / totalKg) * 100) / 100 : null;
  // DH/kg « production » : exclut les jours kg=0 du numérateur et du dénominateur.
  const dhParKgBrutProd = totalKgProd > 0 ? Math.round((totalCoutProd / totalKgProd) * 100) / 100 : null;
  // Moyenne PONDÉRÉE (somme coûts / somme ouvrier-jours), arrondi DH entier
  // pour rester cohérent avec l'affichage existant du jour.
  const coutMoyenOuvrierJour = totalOuvrierJours > 0 ? Math.round(totalCout / totalOuvrierJours) : 0;
  // Moyennes / jour (vue période) : somme ÷ jours-avec-données. Arrondi DH
  // entier pour les coûts, 1 décimale pour les kg (cohérent avec l'affichage).
  const dj = nbJoursAvecDonnees;
  const coutMoyenJour = dj > 0 ? Math.round(totalCout / dj) : 0;
  const kgMoyenJour = dj > 0 ? Math.round((totalKg / dj) * 10) / 10 : 0;
  const salaireMoyenJour = dj > 0 ? Math.round(totalSalaire / dj) : 0;
  const transportMoyenJour = dj > 0 ? Math.round(totalTransport / dj) : 0;
  const primeMoyenJour = dj > 0 ? Math.round(totalPrime / dj) : 0;
  const chargesMoyenJour = dj > 0 ? Math.round(totalCharges / dj) : 0;
  return {
    totalSalaire: totalSalaire,
    totalTransport: totalTransport,
    totalPrime: totalPrime,
    totalCharges: totalCharges,
    totalCout: totalCout,
    totalKg: totalKg,
    totalOuvrierJours: totalOuvrierJours,
    nbJoursAvecDonnees: nbJoursAvecDonnees,
    dhParKgBrut: dhParKgBrut,
    dhParKgBrutProd: dhParKgBrutProd,
    totalCoutProd: totalCoutProd,
    totalKgProd: totalKgProd,
    coutMoyenOuvrierJour: coutMoyenOuvrierJour,
    coutMoyenJour: coutMoyenJour,
    kgMoyenJour: kgMoyenJour,
    salaireMoyenJour: salaireMoyenJour,
    transportMoyenJour: transportMoyenJour,
    primeMoyenJour: primeMoyenJour,
    chargesMoyenJour: chargesMoyenJour,
  };
}

/**
 * Coût logistique net agrégé sur une série de jours logistique.
 * dhParKgNet = (coût récolte + coût logistique) / kg récolté.
 *
 * @param {number} totalCoutRecolte coût récolte sommé sur la plage
 * @param {number} totalLogCout coût logistique sommé sur la plage
 * @param {number} totalKg kg récolté sommé sur la plage
 * @returns {{dhParKgLog:(number|null), dhParKgNet:(number|null)}}
 */
function computeNetDhParKg(totalCoutRecolte, totalLogCout, totalKg) {
  const dhParKgLog = totalKg > 0 ? Math.round((totalLogCout / totalKg) * 100) / 100 : null;
  const dhParKgNet = totalKg > 0 ? Math.round(((totalCoutRecolte + totalLogCout) / totalKg) * 100) / 100 : null;
  return { dhParKgLog: dhParKgLog, dhParKgNet: dhParKgNet };
}

/**
 * Variante « jours de production » du DH/kg net (BUG #pMBZlx03).
 *
 * Calcule DH/kg log et net en n'utilisant QUE les jours de PRODUCTION récolte
 * (kg récolté > 0). Les paires (récolte, logistique) sont alignées par index :
 * `recSeries[i]` et `logSeries[i]` décrivent le MÊME jour. On somme le coût
 * récolte ET le coût logistique uniquement sur les jours où `recSeries[i].kg>0`,
 * et on divise par la somme des kg de ces mêmes jours. Les journées « vides de
 * production » (kg récolté = 0) sont exclues du numérateur et du dénominateur.
 *
 * @param {Array<{salaire?:number, transport?:number, prime?:number, charges?:number, kg?:number}>} recSeries jours récolte (un par jour de la fenêtre)
 * @param {Array<{salaire?:number, transport?:number, prime?:number, charges?:number, kg?:number}>} logSeries jours logistique, alignés par index sur recSeries
 * @returns {{dhParKgLog:(number|null), dhParKgNet:(number|null), totalCoutRecolteProd:number, totalLogCoutProd:number, totalKgProd:number}}
 */
function computeNetDhParKgProd(recSeries, logSeries) {
  const rec = Array.isArray(recSeries) ? recSeries : [];
  const log = Array.isArray(logSeries) ? logSeries : [];
  let totalCoutRecolteProd = 0;
  let totalLogCoutProd = 0;
  let totalKgProd = 0;
  rec.forEach(function (d, i) {
    const kg = (d && d.kg) || 0;
    if (kg <= 0) return; // journée vide de production : exclue
    const recCout = ((d.salaire || 0) + (d.transport || 0) + (d.prime || 0) + (d.charges || 0));
    const l = log[i] || {};
    const logCout = ((l.salaire || 0) + (l.transport || 0) + (l.prime || 0) + (l.charges || 0));
    totalCoutRecolteProd += recCout;
    totalLogCoutProd += logCout;
    totalKgProd += kg;
  });
  const dhParKgLog = totalKgProd > 0 ? Math.round((totalLogCoutProd / totalKgProd) * 100) / 100 : null;
  const dhParKgNet = totalKgProd > 0
    ? Math.round(((totalCoutRecolteProd + totalLogCoutProd) / totalKgProd) * 100) / 100
    : null;
  return {
    dhParKgLog: dhParKgLog,
    dhParKgNet: dhParKgNet,
    totalCoutRecolteProd: totalCoutRecolteProd,
    totalLogCoutProd: totalLogCoutProd,
    totalKgProd: totalKgProd,
  };
}

/**
 * Nombre d'ouvriers DISTINCTS (matricules uniques) sur un ensemble de lignes.
 * Sémantique du KPI « Ouvriers Récolte » (libellé sans « /jour ») =
 * effectif distinct ayant récolté sur la période.
 *
 * @param {Array<{matricule?:string, nom?:string}>} rows
 * @returns {number}
 */
function distinctOuvriersFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = {};
  let n = 0;
  list.forEach(function (r) {
    const key = (r.matricule || r.nom || '').toString().toUpperCase().trim();
    if (!key) return;
    if (!seen[key]) {
      seen[key] = true;
      n += 1;
    }
  });
  return n;
}

export { aggregatePeriodKpis, computeNetDhParKg, computeNetDhParKgProd, distinctOuvriersFromRows };
