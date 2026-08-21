/**
 * coutOuvrierCampagne.js — COÛT OUVRIER CHARGÉ, moyenné sur une campagne.
 *
 * Fonctions PURES : aucune I/O, aucun accès Firestore. L'appelant lit les
 * documents (pointage miroir, registre ouvriers, barèmes, primes de transport)
 * et les passe en argument. C'est ce qui rend ce calcul testable sans émulateur,
 * et vérifiable ligne à ligne contre une fiche de paie réelle.
 *
 * ── CE QUE CE MODULE CALCULE, ET POURQUOI IL EXISTE ────────────────────────
 * Le coût affiché partout dans l'application (`Cout` de BR_Pointage) est le
 * SALAIRE DE BASE : ~99 DH par journée pointée, soit le SMAG brut. Il ne
 * contient NI CNSS patronale, NI prime d'ancienneté, NI prime de fonction, NI
 * aucune prime de terrain. Le coût réel d'une journée pour l'entreprise est
 * sensiblement plus élevé.
 *
 * Formule ARRÊTÉE AVEC OMAR (2026-08-20), qui réunit les deux notions de coût
 * qui coexistaient dans l'app — aucune des deux n'étant complète :
 *   - l'écran Quinzaine additionnait base + primes de terrain, sans CNSS ni
 *     ancienneté ni prime de fonction ;
 *   - l'écran Paie calculait brut + CNSS, sans aucune prime de terrain.
 *
 *   salaire         = SMAG daté × jours       (BEE ONE ne fournit QUE les
 *                     JOURNÉES ; le salaire sort du barème Smart Berry, celui
 *                     des fiches de paie réellement éditées — décision d'Omar,
 *                     2026-08-20. Le `Cout` BEE ONE reste suivi à part, comme
 *                     témoin du rapprochement et pour le facteur de charge.)
 *   primeFonction   = registre × jours
 *   primeAnciennete = (base + primeFonction) × palier %      [déclarés]
 *   heuresSup       = HS_25/50/100 valorisées au taux horaire
 *   ─────────────── brut SOUMIS à cotisation ───────────────
 *   charges         = brut soumis × 19,26 % (patronales)     [déclarés]
 *                     + brut soumis × 6,74 %  (CNSS 4,48 + AMO 2,26 salariales,
 *                       NON retenues à l'ouvrier — donc à la charge de la société)
 *   ─────────────── primes NON soumises ────────────────────
 *   + transport (par jour travaillé) + récolte (aux kilos)
 *   + traitement / conditionnement / chargement (10 DH par jour-ouvrier)
 *   + jours fériés
 *
 *   coût ouvrier DH/JH   = Σ coût total / Σ JH (`Nombre_Jr`)
 *
 * ⚠️ Le dénominateur est en JH, PAS en journées calendaires. Le salaire, lui,
 * se calcule sur les journées (une fiche de paie paie des jours). Mais ce
 * chiffre sert à valoriser des budgets exprimés en JH : mélanger les deux
 * unités fausse toute la grille — avec des demi-journées, elles diffèrent de
 * plusieurs pour cent.
 *
 * L'assiette de cotisation n'est pas réinventée ici : c'est celle du modèle de
 * paie déjà en production (`paieUtils`), primes de terrain exclues.
 *
 * ── TROIS DÉCISIONS QUI CHANGENT LE CHIFFRE ────────────────────────────────
 *  1. C'est un coût par JOURNÉE POINTÉE, pas par ouvrier : un ouvrier présent
 *     15 jours pèse 15 fois plus qu'un ouvrier présent 1 jour. C'est bien ce
 *     qu'on veut, puisque ce coût sert à valoriser des JH.
 *  2. Les NON DÉCLARÉS n'ont ni charges patronales ni prime d'ancienneté. Ils
 *     tirent la moyenne vers le bas — c'est la réalité du coût, pas un biais.
 *  3. L'ANCIENNETÉ est cumulative : elle se calcule sur les jours pointés
 *     DEPUIS le début du registre (`baselineJours`) plus ceux de la campagne,
 *     dans l'ordre chronologique. Traiter chaque quinzaine isolément
 *     sous-estimerait la prime d'ancienneté de tout le monde.
 *
 * Hors périmètre, et c'est volontaire : le POINTAGE DIVERS (sous-traitants) —
 * ces journées ne sont pas des journées d'ouvrier BGF et n'ont pas de fiche de
 * paie.
 */
'use strict';

const { PAIE_BAREMES_DEFAULT, computeWorkerPaie } = require('./paieUtils.js');

/**
 * Préfixe d'équipe de transport d'un matricule. Repris À L'IDENTIQUE de
 * `getEqPrefixForPaie` (public/app.jsx) : deux règles différentes donneraient
 * deux primes de transport différentes pour le même ouvrier.
 *
 * @param {string} matricule
 * @returns {string} préfixe à 2 lettres, 'BGF' par défaut.
 */
function prefixeEquipe(matricule, equipes) {
  const m = String(matricule || '').toUpperCase().trim();
  if (!m) return null;
  if (m.startsWith('HAFI')) return 'HA';
  const p2 = m.substring(0, 2);
  // Le préfixe doit correspondre à une équipe RÉELLE. La version précédente
  // renvoyait 'BGF' par défaut dès que les deux premiers caractères n'étaient
  // pas deux lettres — c'est-à-dire pour TOUS les matricules numériques, la
  // majorité de l'effectif. Elle leur attribuait donc l'équipe BGF, alors que
  // l'écran Quinzaine les classe « inconnu » et ne leur donne aucune prime.
  // Deux écrans, deux transports, pour les mêmes ouvriers.
  //
  // On ne devine plus : sans équipe correspondante, pas de prime. C'est aussi
  // ce que fait la feuille TRANSPORT du bulletin, qui ne liste que des équipes
  // nommées.
  const connu = (equipes || []).some(
    (e) => e && String(e.prefix || '').toUpperCase() === p2
  );
  return connu ? p2 : null;
}

/**
 * Prime de transport d'un matricule, PAR JOUR TRAVAILLÉ (30 DH, 35 pour
 * certaines équipes). Équipe inconnue → 0 : on ne devine pas un montant.
 *
 * ⚠️ L'UNITÉ EST LA JOURNÉE, et c'est le piège de ce module. `coutParOuvrier`
 * se lit comme un forfait, mais les deux écrans qui l'exploitent le comptent
 * par jour : la popup ouvrier du Pointage du jour l'ajoute pour UNE journée, et
 * l'écran Équipes calcule `coutParOuvrier × nombre d'ouvriers` pour UNE journée.
 * Confirmé par Omar (2026-08-20). L'ajouter une fois par quinzaine sous-comptait
 * le transport d'un facteur ~13, soit ~28 DH manquants sur ~146 DH par journée —
 * une sous-estimation de 19 % du coût réel, invisible à l'œil nu.
 *
 * @param {string} matricule
 * @param {Array<{prefix?: string, coutParOuvrier?: number}>} equipes
 * @returns {number} montant PAR JOUR travaillé.
 */
function primeTransport(matricule, equipes) {
  const prefixe = prefixeEquipe(matricule, equipes);
  if (!prefixe) return 0;
  const equipe = (equipes || []).find(
    (e) => e && String(e.prefix || '').toUpperCase() === prefixe
  );
  if (!equipe) return 0;
  const v = Number(equipe.coutParOuvrier);
  return isFinite(v) && v > 0 ? v : 0;
}

/**
 * Journées et heures supplémentaires par ouvrier, à partir des lignes du
 * pointage miroir d'UNE journée. PURE, et cumulatif : l'appelant rejoue la
 * fonction date après date sur le même accumulateur.
 *
 * Une JOURNÉE est comptée une seule fois par ouvrier, quel que soit le nombre
 * de lignes (un ouvrier pointé sur trois parcelles le même jour a travaillé un
 * jour, pas trois). Les heures sup, elles, se somment ligne à ligne.
 *
 * @param {Object} acc accumulateur { [matricule]: {jours: Set, jh, hs25, hs50, hs100, base} }
 * @param {Array<Object>} rows lignes de `sql_mirror_pointage/{date}`
 * @param {string} date 'YYYY-MM-DD'
 */
function cumuleJournee(acc, rows, date) {
  (rows || []).forEach((r) => {
    if (!r) return;
    const mat = String(r.Personnel_Matricule || '').trim();
    if (!mat) return;
    if (!acc[mat]) acc[mat] = { jours: new Set(), jh: 0, hs25: 0, hs50: 0, hs100: 0, base: 0 };
    const e = acc[mat];
    // DEUX unités, et il faut les deux :
    //  - `jours` = journées CALENDAIRES distinctes. C'est ce que paie la fiche
    //    de paie : un ouvrier pointé trois fois le même jour touche un jour.
    //  - `jh` = `Nombre_Jr`, la quantité de journées-homme de BEE ONE. Elle peut
    //    être fractionnaire (demi-journée) ou dépasser 1 (heures converties).
    //    C'est l'unité de TOUT le reste de l'application — la grille Campagne,
    //    les budgets, les JH affichés partout.
    // Le SALAIRE se calcule sur les journées, mais le COÛT PAR JH doit se
    // diviser par les JH : c'est lui qui sert à valoriser un budget en JH.
    e.jours.add(date);
    e.jh += Number(r.Nombre_Jr) || 0;
    e.hs25 += Number(r.HS_25) || 0;
    e.hs50 += Number(r.HS_50) || 0;
    e.hs100 += Number(r.HS_100) || 0;
    // Le SALAIRE DE BASE vient de BEE ONE, ligne à ligne — pas d'un SMAG
    // recalculé : c'est la même source que les DH/Ha de la grille Campagne, ce
    // qui garantit qu'aucun écart inexplicable n'apparaisse entre les deux.
    e.base += Number(r.Cout) || 0;
  });
}

/**
 * PRIME DE RÉCOLTE d'un ouvrier pour une journée, aux kilos cueillis. PURE.
 *
 * Barème repris À L'IDENTIQUE de `calcPrime` (public/app.jsx) — la moindre
 * divergence donnerait deux primes différentes pour la même cueillette selon
 * l'écran consulté :
 *   Framboise : < 20 kg → 0 ; < 25 → 20 ; < 30 → 40 ;
 *               < 40 → 60 + 3 DH/kg au-delà de 30 ; sinon 90 + 4 DH/kg au-delà de 40.
 *   Myrtille  : 2,5 DH par kilo au-delà d'un seuil — 25 pour Breeze, 30 pour
 *               Corina, et 25 puis 30 (à partir du 25/04/2026) pour Cascade.
 *
 * @param {number} kg kilos cueillis dans la journée.
 * @param {string} variete variété cueillie.
 * @param {string} date 'YYYY-MM-DD' (le seuil Cascade a changé en cours de campagne).
 * @returns {number} prime en DH.
 */
function primeRecolte(kg, variete, date) {
  const k = Number(kg) || 0;
  const v = String(variete || '');
  const estMyrtille = /corina|corrina|cascade|breeze|myrtille|blue/i.test(v);
  if (estMyrtille) {
    const seuil = /breeze/i.test(v) ? 25
      : /cascade/i.test(v) ? (String(date || '') >= '2026-04-25' ? 30 : 25)
        : 30;
    return k > seuil ? Math.round((k - seuil) * 2.5 * 10) / 10 : 0;
  }
  if (k < 20) return 0;
  if (k < 25) return 20;
  if (k < 30) return 40;
  if (k < 40) return Math.round((60 + (k - 30) * 3) * 10) / 10;
  return Math.round((90 + (k - 40) * 4) * 10) / 10;
}

/**
 * Paie d'UN ouvrier sur UNE quinzaine, à partir du salaire de base BEE ONE.
 * PURE.
 *
 * Reprend les règles du modèle de paie en production (`paieUtils`) — paliers
 * d'ancienneté, SMAG daté pour le taux horaire des heures sup, taux de charges
 * patronales — mais part du COÛT RÉELLEMENT ENREGISTRÉ plutôt que d'un SMAG
 * recalculé. Recalculer la base donnerait un chiffre qui ne se recoupe avec
 * aucune autre valeur de l'écran.
 *
 * @param {Object} args
 * @param {number} args.jours journées pointées (BEE ONE ne sert QU'À ÇA).
 * @param {boolean} args.declare ouvrier déclaré (CNSS + ancienneté).
 * @param {number} args.anciennete jours pointés cumulés, pour le palier.
 * @param {number} args.primeFonctionJour prime de fonction journalière.
 * @param {{hs25: number, hs50: number, hs100: number}} args.hs heures sup.
 * @param {{transport?: number, recolte?: number, traitement?: number,
 *   conditionnement?: number, chargement?: number, feries?: number}} args.primes
 *   montants DÉJÀ valorisés en DH pour la quinzaine.
 * @param {Object} args.baremes barèmes de paie.
 * @param {string} args.dateISO date de résolution du SMAG (fin de quinzaine).
 * @returns {{brutSoumis: number, chargesPatronales: number, cotisationsSalariales: number,
 *   primesNonSoumises: number, primeAnciennete: number, primeFonction: number,
 *   heuresSup: number, salaireBase: number, total: number}}
 */
function paieOuvrierQuinzaine(args) {
  const a = args || {};
  const b = Object.assign({}, PAIE_BAREMES_DEFAULT, a.baremes || {});
  const jours = Number(a.jours) || 0;
  const declare = !!a.declare;
  const primes = a.primes || {};
  const hs = a.hs || {};

  // SALAIRE : calculé par le modèle Smart Berry, PAS repris de BEE ONE.
  // BEE ONE ne fournit que les JOURNÉES ; le salaire, lui, sort du barème
  // maison (SMAG daté + prime de fonction + ancienneté + heures sup), qui est
  // celui des fiches de paie réellement éditées. Décision d'Omar (2026-08-20).
  // Les primes de terrain sont passées à zéro ici : elles sont ajoutées plus
  // bas, hors assiette, pour garder la maîtrise de ce qui cotise.
  const paie = computeWorkerPaie({
    declare,
    joursTravailles: jours,
    anciennete: Number(a.anciennete) || 0,
    baremes: b,
    dateISO: a.dateISO || '',
    primeFonctionJour: Number(a.primeFonctionJour) || 0,
    primeTransport: 0,
    primeRecolte: 0,
    hs25: hs.hs25,
    hs50: hs.hs50,
    hs100: hs.hs100,
  });

  // JOURS FÉRIÉS — reçus en NOMBRE DE JOURS, plus en dirhams.
  //
  // Ils valaient auparavant le coût journalier moyen BEE ONE : 110,6 DH par jour
  // là où le bulletin en verse 90,9, tout en PERDANT la prime de fonction et
  // l'ancienneté de ces journées. Deux erreurs de sens contraire dont la somme
  // paraissait juste. Même correction que l'écran Quinzaine (2026-08-21).
  //
  // Le coût est calculé par DIFFÉRENCE — paie(jours + fériés) − paie(jours) —
  // pour qu'il vaille exactement ce que le barème donne, quel que soit le détail
  // de celui-ci, plutôt que de réimplémenter la règle et de la laisser diverger.
  const nbFeries = Number(a.feriesJours) || 0;
  let feries = 0;
  if (nbFeries > 0) {
    const avecFeries = computeWorkerPaie({
      declare,
      joursTravailles: jours + nbFeries,
      anciennete: Number(a.anciennete) || 0,
      baremes: b,
      dateISO: a.dateISO || '',
      primeFonctionJour: Number(a.primeFonctionJour) || 0,
      primeTransport: 0, primeRecolte: 0,
      hs25: hs.hs25, hs50: hs.hs50, hs100: hs.hs100,
    });
    feries = avecFeries.brut - paie.brut;
  }

  // HEURES SUPPLÉMENTAIRES accordées (collection rh_heures_sup) — montant NET,
  // remonté au brut : le bulletin les range dans le brut, donc elles cotisent.
  const hsNet = Number(a.heuresSupNet) || 0;
  const tauxSal = Number(b.tauxCotisationsSalariales) || 0;
  const hsBrut = hsNet > 0 ? (declare && tauxSal < 1 ? hsNet / (1 - tauxSal) : hsNet) : 0;

  const brutSoumis = paie.brut + feries + hsBrut;
  // Charges recalculées sur l'assiette COMPLÈTE (fériés compris) : celles que
  // rend `computeWorkerPaie` ne les connaissent pas.
  const chargesPatronales = declare ? brutSoumis * (b.tauxChargesPatronales || 0) : 0;
  // Part SALARIALE : l'entreprise la reverse à la CNSS pour un déclaré. Elle est
  // donc bien dans le coût — mais À TRAVERS le brut, puisque brut = net + part
  // salariale. Le total ci-dessous ne l'ajoute PLUS une seconde fois.
  //
  // Correction du 2026-08-21 : elle l'était, ce qui surévaluait le coût de
  // campagne de 6,74 % du brut déclaré. L'erreur venait de la prémisse « payé
  // sur le brut sans retenue » — démentie par les bulletins, où le montant
  // viré vaut brut × 0,933.
  const cotisationsSalariales = declare ? brutSoumis * (b.tauxCotisationsSalariales || 0) : 0;

  const primesNonSoumises = (Number(primes.transport) || 0)
    + (Number(primes.recolte) || 0)
    + (Number(primes.traitement) || 0)
    + (Number(primes.conditionnement) || 0)
    + (Number(primes.chargement) || 0);

  return {
    brutSoumis,
    chargesPatronales,
    cotisationsSalariales,
    primesNonSoumises,
    primeAnciennete: paie.primeAnciennete,
    primeFonction: paie.primeFonction,
    heuresSup: (paie.heuresSup && paie.heuresSup.montant) || 0,
    // Salaire de base seul (SMAG × jours), pour que le détail se recompose.
    salaireBase: paie.smagBaseTotal,
    feries,
    // HS ACCORDÉES (rh_heures_sup), distinctes des HS_25/50/100 du modèle
    // ci-dessus : deux notions, deux clés. Les confondre écrasait la seconde.
    heuresSupAccordees: hsBrut,
    // Retenue d'un NON déclaré : ni versée à lui, ni reversée à la CNSS. Terme
    // négatif du coût — sans lui, le détail ne se recompose pas dans le total.
    retenueNonReversee: declare ? 0 : brutSoumis * (b.tauxCotisationsSalariales || 0),
    // Déclaré : brut + patronales (le brut porte déjà la part salariale reversée).
    // Non déclaré : rien n'est reversé, le coût est le NET qu'il touche.
    total: (declare ? brutSoumis + chargesPatronales
      : brutSoumis * (1 - (b.tauxCotisationsSalariales || 0))) + primesNonSoumises,
  };
}

/**
 * Coût ouvrier moyen d'une campagne, en DH par journée pointée. PURE.
 *
 * `null` sur `coutMoyenJour` quand aucune journée n'est pointée : « aucune
 * donnée » n'est pas « coût nul », et un 0 propagé dans un budget en DH
 * afficherait un budget nul partout.
 *
 * @param {Object} args
 * @param {Array<{periode: string, dateFin: string, parOuvrier: Object}>} args.quinzaines
 *   Une entrée par quinzaine, DANS L'ORDRE CHRONOLOGIQUE (l'ancienneté se
 *   cumule). `parOuvrier[matricule]` = {jours: Set, hs25, hs50, hs100, base,
 *   primes?: {recolte, traitement, conditionnement, chargement, feries}}.
 * @param {Object<string, Object>} args.registre matricule → fiche.
 * @param {Object} args.baremes barèmes de paie.
 * @param {Array<Object>} args.equipesTransport équipes de transport.
 * @returns {{coutMoyenJour: number|null, jh: number, facteurCharge: number|null,
 *   coutTotal: number, jours: number, ouvriers: number, quinzaines: number,
 *   partDeclares: number|null, detail: Object, parQuinzaine: Array<Object>}}
 */
function coutOuvrierCampagne(args) {
  const a = args || {};
  const registre = a.registre || {};
  const quinzaines = a.quinzaines || [];

  // Ancienneté cumulée : jours pointés depuis le début du registre. Portée
  // ENTRE les quinzaines, d'où l'accumulateur en dehors de la boucle.
  const joursCumules = {};
  const matriculesVus = new Set();

  let coutTotal = 0;
  let jours = 0;
  let jhTotal = 0;
  let joursDeclares = 0;
  const detail = {
    salaire: 0, baseBeeOne: 0, primeFonction: 0, primeAnciennete: 0, heuresSup: 0,
    chargesPatronales: 0, cotisationsSalariales: 0,
    // Retenue NON REVERSÉE : celle des non-déclarés. Elle ne va ni à l'ouvrier
    // (il touche le net) ni à la CNSS (il n'est pas déclaré). Terme NÉGATIF du
    // coût, et seul moyen pour que le détail se recompose exactement.
    retenueNonDeclares: 0, transport: 0, recolte: 0,
    traitement: 0, conditionnement: 0, chargement: 0, feries: 0,
    heuresSupAccordees: 0,
  };

  // Détail PAR QUINZAINE : c'est lui qui rend le rapprochement avec l'écran
  // Quinzaine vérifiable, quinzaine par quinzaine, sans ressaisir un chiffre.
  const parQuinzaine = [];
  // TAUX PAR OUVRIER ET PAR QUINZAINE, en DH par JH. C'est lui qui permet à la
  // grille Campagne de valoriser chaque ligne au coût de L'OUVRIER qui l'a
  // faite, au lieu d'une moyenne d'établissement appliquée à tout le monde.
  // Clé « matricule|periode » : un même ouvrier n'a pas le même taux d'une
  // quinzaine à l'autre (SMAG daté, ancienneté qui monte, primes qui changent).
  //
  // Nom distinct de `parOuvrier` À DESSEIN : la boucle ci-dessous déclare un
  // `const parOuvrier` local (les lignes d'ENTRÉE de la quinzaine) qui masquait
  // celui-ci — les écritures partaient silencieusement dans la map d'entrée et
  // la sortie restait vide.
  const tauxParOuvrier = {};

  quinzaines.forEach((q) => {
    const parOuvrier = (q && q.parOuvrier) || {};
    const cumulQ = { periode: (q && q.periode) || '', jours: 0, jh: 0, base: 0,
      salaire: 0, primes: 0, charges: 0, coutTotal: 0 };
    Object.keys(parOuvrier).forEach((mat) => {
      const e = parOuvrier[mat];
      const joursTravailles = e.jours instanceof Set ? e.jours.size : Number(e.jours) || 0;
      if (!(joursTravailles > 0)) return;
      matriculesVus.add(mat);

      const fiche = registre[mat] || {};
      const declare = !!fiche.declare;
      const socle = Number(fiche.baselineJours) || 0;
      const anciennete = socle + (joursCumules[mat] || 0);

      const primesOuvrier = Object.assign({}, e.primes || {}, {
        // × jours : la prime de transport est due PAR JOUR TRAVAILLÉ.
        transport: primeTransport(mat, a.equipesTransport) * joursTravailles,
      });

      const paie = paieOuvrierQuinzaine({
        jours: joursTravailles,
        declare,
        anciennete,
        primeFonctionJour: Number(fiche.primeFonctionJournaliere) || 0,
        hs: { hs25: e.hs25, hs50: e.hs50, hs100: e.hs100 },
        primes: primesOuvrier,
        // Jours fériés en NOMBRE : leur coût est calculé par le barème, plus
        // repris du coût moyen BEE ONE.
        feriesJours: Number(e.feriesJours) || 0,
        // Heures sup accordées (rh_heures_sup), montant NET.
        heuresSupNet: Number((q.heuresSupNet || {})[mat]) || 0,
        baremes: a.baremes || {},
        // SMAG daté : celui en vigueur À LA FIN de la quinzaine payée.
        dateISO: q.dateFin || '',
      });

      coutTotal += paie.total;
      jours += joursTravailles;
      jhTotal += Number(e.jh) || 0;
      if (declare) joursDeclares += joursTravailles;

      // `baseBeeOne` n'entre PAS dans le coût : c'est le témoin qui sert au
      // facteur de charge (la grille Campagne affiche ce coût-là) et au
      // rapprochement. Le coût, lui, est calculé par le modèle Smart Berry.
      detail.baseBeeOne += Number(e.base) || 0;
      detail.salaire += paie.salaireBase;
      detail.primeFonction += paie.primeFonction;
      detail.primeAnciennete += paie.primeAnciennete;
      detail.heuresSup += paie.heuresSup;
      detail.chargesPatronales += paie.chargesPatronales;
      detail.cotisationsSalariales += paie.cotisationsSalariales;
      detail.retenueNonDeclares += paie.retenueNonReversee;
      ['transport', 'recolte', 'traitement', 'conditionnement', 'chargement']
        .forEach((k) => { detail[k] += Number(primesOuvrier[k]) || 0; });
      // Fériés et heures sup accordées viennent désormais du barème, pas des primes.
      detail.feries += paie.feries;
      detail.heuresSupAccordees += paie.heuresSupAccordees;

      cumulQ.jours += joursTravailles;
      cumulQ.jh += Number(e.jh) || 0;
      cumulQ.base += Number(e.base) || 0;
      cumulQ.salaire += paie.salaireBase;
      cumulQ.primes += paie.primesNonSoumises + (Number(primesOuvrier.feries) || 0)
        + paie.primeFonction + paie.primeAnciennete + paie.heuresSup;
      // `base` reste le témoin BEE ONE (rapprochement), `salaire` le calcul
      // Smart Berry : les deux se lisent côte à côte dans le panneau.
      //
      // CHARGES = la patronale SEULE. La part salariale est déjà dans le brut
      // (brut = net + part salariale) et l'entreprise la reverse ; l'ajouter
      // ici la compterait deux fois. Pour un non-déclaré, la retenue n'est
      // reversée à personne : elle sort du coût, d'où le terme négatif.
      cumulQ.charges += paie.chargesPatronales - paie.retenueNonReversee;
      cumulQ.coutTotal += paie.total;

      var jhOuvrier = Number(e.jh) || 0;
      if (jhOuvrier > 0) tauxParOuvrier[mat + '|' + cumulQ.periode] = paie.total / jhOuvrier;

      joursCumules[mat] = (joursCumules[mat] || 0) + joursTravailles;
    });
    parQuinzaine.push(cumulQ);
  });

  return {
    // Coût par JH — et NON par journée calendaire. Ce chiffre sert à valoriser
    // des budgets exprimés en JH : le diviser par autre chose que des JH
    // fausserait toute la grille Campagne. Avec des demi-journées, les deux
    // dénominateurs diffèrent de plusieurs pour cent.
    coutMoyenJour: jhTotal > 0 ? coutTotal / jhTotal : null,
    // Journées calendaires distinctes, conservées : c'est l'assiette de la
    // paie (un ouvrier pointé trois fois le même jour touche un jour) et le
    // rapport entre les deux se lit dans l'infobulle.
    jh: jhTotal,
    // FACTEUR DE CHARGE : combien coûte réellement un dirham de salaire de base.
    // C'est lui qui rend comparables les deux côtés de la grille Campagne — le
    // réalisé y vient du `Cout` BEE ONE (base nue), le budget est valorisé au
    // coût chargé. Sans facteur, on compare une dépense hors charges à un budget
    // chargé, et le « % consommé » est sous-estimé d'un quart.
    // `null` sans base : un facteur de 1 ferait passer un coût nu pour un coût
    // complet, ce qui est précisément l'erreur qu'on corrige.
    facteurCharge: detail.baseBeeOne > 0 ? coutTotal / detail.baseBeeOne : null,
    coutTotal,
    jours,
    ouvriers: matriculesVus.size,
    quinzaines: quinzaines.length,
    detail,
    parQuinzaine,
    tauxParOuvrier,
    partDeclares: jours > 0 ? joursDeclares / jours : null,
  };
}

module.exports = {
  prefixeEquipe, primeTransport, primeRecolte, cumuleJournee,
  paieOuvrierQuinzaine, coutOuvrierCampagne,
};
