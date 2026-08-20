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
 * BRUT BEE ONE : ni CNSS patronale, ni prime de transport. Le coût réel d'une
 * journée de travail pour l'entreprise est ~19 % plus élevé sur un ouvrier
 * déclaré, plus le transport.
 *
 * Formule, par ouvrier ET par quinzaine (le modèle de paie lui-même vit dans
 * `paieUtils.computeWorkerPaie`, source unique, déjà en production dans la
 * popup ouvrier) :
 *
 *   brut           = (SMAG daté + prime de fonction) × jours + prime d'ancienneté
 *                    + heures supplémentaires
 *   chargesPatron. = brut × taux (UNIQUEMENT si l'ouvrier est déclaré)
 *   coutTotal      = brut + chargesPatronales + prime de transport
 *
 *   coût ouvrier DH/jour = Σ coutTotalEmployeur / Σ jours pointés
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
 * paie. Le coût de récolte à la tâche (prime de récolte) n'est pas non plus
 * reconstitué ici : il n'existe pas par ouvrier-quinzaine dans le miroir.
 */
'use strict';

const { computeWorkerPaie } = require('./paieUtils.js');

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
 * Prime de transport d'un matricule, depuis la configuration des équipes.
 * Équipe inconnue → 0 : on ne devine pas un montant.
 *
 * @param {string} matricule
 * @param {Array<{prefix?: string, coutParOuvrier?: number}>} equipes
 * @returns {number}
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
 * @param {Object} acc accumulateur { [matricule]: {jours: Set, hs25, hs50, hs100} }
 * @param {Array<Object>} rows lignes de `sql_mirror_pointage/{date}`
 * @param {string} date 'YYYY-MM-DD'
 */
function cumuleJournee(acc, rows, date) {
  (rows || []).forEach((r) => {
    if (!r) return;
    const mat = String(r.Personnel_Matricule || '').trim();
    if (!mat) return;
    if (!acc[mat]) acc[mat] = { jours: new Set(), hs25: 0, hs50: 0, hs100: 0 };
    const e = acc[mat];
    e.jours.add(date);
    e.hs25 += Number(r.HS_25) || 0;
    e.hs50 += Number(r.HS_50) || 0;
    e.hs100 += Number(r.HS_100) || 0;
  });
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
 *   cumule). `parOuvrier` = sortie de `cumuleJournee` pour cette quinzaine.
 * @param {Object<string, Object>} args.registre matricule → fiche
 *   ({declare, baselineJours, baselineDate, primeFonctionJournaliere}).
 * @param {Object} args.baremes barèmes de paie (app_settings/paie_baremes).
 * @param {Array<Object>} args.equipesTransport équipes (rh_config/transport_primes).
 * @returns {{coutMoyenJour: number|null, coutTotal: number, jours: number,
 *   ouvriers: number, quinzaines: number,
 *   detail: {brut: number, chargesPatronales: number, transport: number},
 *   partDeclares: number|null}}
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
  let brutTotal = 0;
  let chargesTotal = 0;
  let transportTotal = 0;
  let joursDeclares = 0;

  quinzaines.forEach((q) => {
    const parOuvrier = (q && q.parOuvrier) || {};
    Object.keys(parOuvrier).forEach((mat) => {
      const e = parOuvrier[mat];
      const joursTravailles = e.jours instanceof Set ? e.jours.size : Number(e.jours) || 0;
      if (!(joursTravailles > 0)) return;
      matriculesVus.add(mat);

      const fiche = registre[mat] || {};
      const declare = !!fiche.declare;
      // Ancienneté = socle du registre + tout ce qui a été pointé depuis, y
      // compris les quinzaines déjà traitées de cette campagne.
      const socle = Number(fiche.baselineJours) || 0;
      const anciennete = socle + (joursCumules[mat] || 0);

      const paie = computeWorkerPaie({
        declare,
        joursTravailles,
        anciennete,
        baremes: a.baremes || {},
        // SMAG daté : celui en vigueur À LA FIN de la quinzaine payée.
        dateISO: q.dateFin || '',
        primeFonctionJour: Number(fiche.primeFonctionJournaliere) || 0,
        primeTransport: primeTransport(mat, a.equipesTransport),
        hs25: e.hs25,
        hs50: e.hs50,
        hs100: e.hs100,
      });

      coutTotal += paie.coutTotalEmployeur;
      brutTotal += paie.brut;
      chargesTotal += paie.chargesPatronales;
      transportTotal += paie.primeTransport;
      jours += joursTravailles;
      if (declare) joursDeclares += joursTravailles;

      joursCumules[mat] = (joursCumules[mat] || 0) + joursTravailles;
    });
  });

  return {
    coutMoyenJour: jours > 0 ? coutTotal / jours : null,
    coutTotal,
    jours,
    ouvriers: matriculesVus.size,
    quinzaines: quinzaines.length,
    detail: { brut: brutTotal, chargesPatronales: chargesTotal, transport: transportTotal },
    partDeclares: jours > 0 ? joursDeclares / jours : null,
  };
}

module.exports = { prefixeEquipe, primeTransport, cumuleJournee, coutOuvrierCampagne };
