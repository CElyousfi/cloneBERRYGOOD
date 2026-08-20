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
 *   base            = Σ Cout BEE ONE          (le coût réellement enregistré,
 *                     et non un SMAG recalculé : c'est la MÊME source que les
 *                     DH/Ha de la grille, donc aucun écart inexplicable)
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
 *   coût ouvrier DH/jour = Σ coût total / Σ journées pointées
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

const { PAIE_BAREMES_DEFAULT, trouverPalierAnciennete, resolveSmagForDate } = require('./paieUtils.js');

/**
 * Préfixe d'équipe de transport d'un matricule. Repris À L'IDENTIQUE de
 * `getEqPrefixForPaie` (public/app.jsx) : deux règles différentes donneraient
 * deux primes de transport différentes pour le même ouvrier.
 *
 * @param {string} matricule
 * @returns {string} préfixe à 2 lettres, 'BGF' par défaut.
 */
function prefixeEquipe(matricule) {
  const m = String(matricule || '').toUpperCase().trim();
  if (m.startsWith('HAFI')) return 'HA';
  const p2 = m.substring(0, 2);
  return /^[A-Z]{2}$/.test(p2) ? p2 : 'BGF';
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
  const prefixe = prefixeEquipe(matricule);
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
 * @param {Object} acc accumulateur { [matricule]: {jours: Set, hs25, hs50, hs100, base} }
 * @param {Array<Object>} rows lignes de `sql_mirror_pointage/{date}`
 * @param {string} date 'YYYY-MM-DD'
 */
function cumuleJournee(acc, rows, date) {
  (rows || []).forEach((r) => {
    if (!r) return;
    const mat = String(r.Personnel_Matricule || '').trim();
    if (!mat) return;
    if (!acc[mat]) acc[mat] = { jours: new Set(), hs25: 0, hs50: 0, hs100: 0, base: 0 };
    const e = acc[mat];
    e.jours.add(date);
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
 * @param {number} args.base salaire de base BEE ONE de la quinzaine.
 * @param {number} args.jours journées pointées.
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
 *   heuresSup: number, total: number}}
 */
function paieOuvrierQuinzaine(args) {
  const a = args || {};
  const b = Object.assign({}, PAIE_BAREMES_DEFAULT, a.baremes || {});
  const jours = Number(a.jours) || 0;
  const base = Number(a.base) || 0;
  const declare = !!a.declare;
  const primes = a.primes || {};
  const hs = a.hs || {};

  const primeFonction = (Number(a.primeFonctionJour) || 0) * jours;
  const baseAnciennete = base + primeFonction;
  // Ancienneté : réservée aux déclarés, comme dans le modèle de paie.
  const palier = declare
    ? trouverPalierAnciennete(Number(a.anciennete) || 0, b.paliers)
    : { pourcentage: 0 };
  const primeAnciennete = baseAnciennete * ((palier.pourcentage || 0) / 100);

  // Heures sup valorisées au taux horaire du SMAG daté — même règle que
  // `paieUtils.computeWorkerPaie`, déclarés comme non déclarés.
  const smag = resolveSmagForDate(b, a.dateISO || '');
  const hParJour = Number(b.heuresNormalesParJour) || 8;
  const tauxHoraire = hParJour > 0 ? smag.smagBrutJournalier / hParJour : 0;
  const heuresSup = ((Number(hs.hs25) || 0) * 1.25
    + (Number(hs.hs50) || 0) * 1.5
    + (Number(hs.hs100) || 0) * 2) * tauxHoraire;

  // Les jours fériés entrent dans le SALAIRE (donc dans l'assiette), les autres
  // primes non — c'est le découpage du modèle de paie en production.
  const feries = Number(primes.feries) || 0;
  const brutSoumis = baseAnciennete + primeAnciennete + heuresSup + feries;
  const chargesPatronales = declare ? brutSoumis * (b.tauxChargesPatronales || 0) : 0;
  // COTISATIONS SALARIALES (CNSS 4,48 % + AMO 2,26 %) — comptées comme un COÛT
  // ENTREPRISE, et ce n'est pas un doublon : le modèle de paie validé en 2026-06
  // paie l'ouvrier sur le SMAG **brut**, SANS aucune retenue. Ce que la loi
  // prélèverait sur son salaire, la société le verse en plus. Décision d'Omar
  // (2026-08-20). Réservé aux déclarés, comme la part patronale : un ouvrier non
  // déclaré ne cotise nulle part.
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
    primeAnciennete,
    primeFonction,
    heuresSup,
    total: brutSoumis + chargesPatronales + cotisationsSalariales + primesNonSoumises,
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
 * @returns {{coutMoyenJour: number|null, facteurCharge: number|null,
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
  let joursDeclares = 0;
  const detail = {
    base: 0, primeFonction: 0, primeAnciennete: 0, heuresSup: 0,
    chargesPatronales: 0, cotisationsSalariales: 0, transport: 0, recolte: 0,
    traitement: 0, conditionnement: 0, chargement: 0, feries: 0,
  };

  // Détail PAR QUINZAINE : c'est lui qui rend le rapprochement avec l'écran
  // Quinzaine vérifiable, quinzaine par quinzaine, sans ressaisir un chiffre.
  const parQuinzaine = [];

  quinzaines.forEach((q) => {
    const parOuvrier = (q && q.parOuvrier) || {};
    const cumulQ = { periode: (q && q.periode) || '', jours: 0, base: 0,
      primes: 0, charges: 0, coutTotal: 0 };
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
        base: e.base,
        jours: joursTravailles,
        declare,
        anciennete,
        primeFonctionJour: Number(fiche.primeFonctionJournaliere) || 0,
        hs: { hs25: e.hs25, hs50: e.hs50, hs100: e.hs100 },
        primes: primesOuvrier,
        baremes: a.baremes || {},
        // SMAG daté : celui en vigueur À LA FIN de la quinzaine payée.
        dateISO: q.dateFin || '',
      });

      coutTotal += paie.total;
      jours += joursTravailles;
      if (declare) joursDeclares += joursTravailles;

      detail.base += Number(e.base) || 0;
      detail.primeFonction += paie.primeFonction;
      detail.primeAnciennete += paie.primeAnciennete;
      detail.heuresSup += paie.heuresSup;
      detail.chargesPatronales += paie.chargesPatronales;
      detail.cotisationsSalariales += paie.cotisationsSalariales;
      ['transport', 'recolte', 'traitement', 'conditionnement', 'chargement', 'feries']
        .forEach((k) => { detail[k] += Number(primesOuvrier[k]) || 0; });

      cumulQ.jours += joursTravailles;
      cumulQ.base += Number(e.base) || 0;
      cumulQ.primes += paie.primesNonSoumises + (Number(primesOuvrier.feries) || 0)
        + paie.primeFonction + paie.primeAnciennete + paie.heuresSup;
      cumulQ.charges += paie.chargesPatronales + paie.cotisationsSalariales;
      cumulQ.coutTotal += paie.total;

      joursCumules[mat] = (joursCumules[mat] || 0) + joursTravailles;
    });
    parQuinzaine.push(cumulQ);
  });

  return {
    coutMoyenJour: jours > 0 ? coutTotal / jours : null,
    // FACTEUR DE CHARGE : combien coûte réellement un dirham de salaire de base.
    // C'est lui qui rend comparables les deux côtés de la grille Campagne — le
    // réalisé y vient du `Cout` BEE ONE (base nue), le budget est valorisé au
    // coût chargé. Sans facteur, on compare une dépense hors charges à un budget
    // chargé, et le « % consommé » est sous-estimé d'un quart.
    // `null` sans base : un facteur de 1 ferait passer un coût nu pour un coût
    // complet, ce qui est précisément l'erreur qu'on corrige.
    facteurCharge: detail.base > 0 ? coutTotal / detail.base : null,
    coutTotal,
    jours,
    ouvriers: matriculesVus.size,
    quinzaines: quinzaines.length,
    detail,
    parQuinzaine,
    partDeclares: jours > 0 ? joursDeclares / jours : null,
  };
}

module.exports = {
  prefixeEquipe, primeTransport, primeRecolte, cumuleJournee,
  paieOuvrierQuinzaine, coutOuvrierCampagne,
};
