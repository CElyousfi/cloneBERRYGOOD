/*
 * coutQuinzaineSnapshot.js — l'INSTANTANÉ du coût d'une quinzaine, tel que
 * l'écran Quinzaine l'a calculé. Fonctions PURES, aucune I/O.
 *
 * ── POURQUOI CE MODULE EXISTE ──────────────────────────────────────────────
 * L'écran Campagne et l'écran Quinzaine additionnaient la même main d'œuvre par
 * deux chemins, et affichaient deux chiffres — 168 071 contre 202 528 DH sur la
 * Quinzaine 01. Chaque tentative de faire converger le second calcul sur le
 * premier a produit une nouvelle divergence : le transport résolu au mauvais
 * format de date, un préfixe d'équipe deviné, une part salariale comptée d'un
 * côté et pas de l'autre. Trois fois la même leçon.
 *
 * On arrête donc de RECALCULER. L'écran Quinzaine — celui qu'Omar rapproche de
 * son fichier de paie, donc celui qui fait foi — enregistre son propre total,
 * et l'écran Campagne le relit tel quel. L'écart affiché redevient un écart
 * RÉEL entre deux mesures, au lieu d'un écart entre deux implémentations.
 *
 * ── CE QU'ON REFUSE D'ENREGISTRER, ET POURQUOI ─────────────────────────────
 * L'écran Quinzaine porte des filtres (ferme, culture, sous-périmètre). Un
 * total calculé sous filtre est un SOUS-total : l'enregistrer comme référence
 * empoisonnerait le rapprochement de façon silencieuse et durable — l'écart
 * paraîtrait énorme, et personne ne saurait qu'il vient d'un filtre laissé actif
 * la veille. `valider` refuse donc tout instantané qui n'est pas de plein
 * périmètre, et tout total nul ou non fini.
 */
// @ts-check
'use strict';

/** Postes attendus dans la ventilation. Ordre = celui de l'écran. */
const POSTES = [
  'moRecolte', 'moHorsRecolte', 'postesFixes', 'primeRecolte', 'primeTransport',
  'autresPrimes', 'heuresSup', 'chargesSociales', 'locationEngins',
];

/**
 * SOUS-POSTES d'« Autres Primes ».
 *
 * Sans eux, « Autres Primes » est un seul nombre, et le jour férié y est
 * indiscernable. Or c'est LUI le suspect : la seule quinzaine sans jour férié
 * est la seule sans écart avec le fichier de paie (161 DH, contre 4 455 et
 * 4 830 sur les deux autres). Tant que le poste reste agrégé, on ne peut ni
 * confirmer ni infirmer — on ne peut que supposer, ce qui a déjà coûté quatre
 * diagnostics faux.
 */
const SOUS_POSTES = ['traitement', 'conditionnement', 'chargement', 'jourFerie'];

/**
 * Normalise un nombre. PURE.
 *
 * `NaN` et `Infinity` deviennent 0 : un total non fini sérialisé en JSON
 * devient `null`, et un `null` relu se lit comme « pas de donnée » alors qu'il
 * s'agit d'un bug de calcul. Mieux vaut un 0 que `valider` rejettera.
 *
 * @param {*} v
 * @returns {number}
 */
function nombre(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/**
 * Normalise un instantané reçu du client. PURE.
 *
 * Ne garde QUE les champs connus : le client envoie ce qu'il veut, le document
 * stocké a une forme fixe. Un champ inattendu qui survivrait finirait par être
 * lu quelque part comme s'il faisait autorité.
 *
 * @param {Object} brut corps de la requête.
 * @returns {{periode: string, dateDebut: string, dateFin: string,
 *   coutEmployeur: number, netAPayer: number, masseSalariale: number,
 *   jours: number, joursFeries: number, pleinPerimetre: boolean,
 *   postes: Object<string, number>, sousPostes: Object<string, number>,
 *   population: {declares: number, nonDeclares: number, brutDeclare: number}}}
 */
function normaliser(brut) {
  const b = brut || {};
  const postes = {};
  const src = b.postes || {};
  POSTES.forEach((k) => { postes[k] = nombre(src[k]); });
  const sousPostes = {};
  const srcS = b.sousPostes || {};
  SOUS_POSTES.forEach((k) => { sousPostes[k] = nombre(srcS[k]); });
  const pop = b.population || {};
  return {
    sousPostes,
    // JOURS fériés en NOMBRE, pas en dirhams. C'est le nombre qui se compare au
    // fichier, et c'est lui qui a révélé un écart de DONNÉES que les montants
    // masquaient : le pointage BEE ONE compte 39 présents le 14/08 quand la
    // paie en compte 72. Un montant seul aurait laissé croire à un problème de
    // valorisation.
    joursFeries: nombre(b.joursFeries),
    // Populations, pour recouper les deux feuilles du fichier. Un ouvrier
    // classé déclaré d'un côté et non déclaré de l'autre décale les charges
    // sans rien changer aux journées — invisible dans les totaux.
    population: {
      declares: nombre(pop.declares),
      nonDeclares: nombre(pop.nonDeclares),
      brutDeclare: nombre(pop.brutDeclare),
    },
    periode: String(b.periode || '').trim(),
    // BORNES de la quinzaine. Un libellé « Quinzaine 03 » ne dit pas à quelles
    // dates il correspond : sans elles, apparier un fichier de paie à son
    // instantané suppose de connaître la numérotation, et un appariement par
    // nombre de journées échoue dès que deux quinzaines en ont autant.
    dateDebut: String(b.dateDebut || '').trim(),
    dateFin: String(b.dateFin || '').trim(),
    coutEmployeur: nombre(b.coutEmployeur),
    netAPayer: nombre(b.netAPayer),
    masseSalariale: nombre(b.masseSalariale),
    jours: nombre(b.jours),
    // Le client DÉCLARE que rien n'était filtré. Le serveur ne peut pas le
    // vérifier — il ne voit pas l'écran — mais il peut refuser un instantané
    // qui ne le déclare pas, plutôt que d'enregistrer un sous-total à son insu.
    pleinPerimetre: b.pleinPerimetre === true,
    postes,
  };
}

/**
 * Dit si un instantané mérite d'être enregistré. PURE.
 *
 * Rend la RAISON du refus, pas un booléen : un enregistrement qui échoue en
 * silence laisse l'écran Campagne afficher « — » sans que personne ne sache
 * qu'il faut ouvrir la Quinzaine, ni pourquoi.
 *
 * @param {Object} snap sortie de `normaliser`.
 * @returns {{ok: boolean, raison: string}}
 */
function valider(snap) {
  const s = snap || {};
  if (!s.periode) return { ok: false, raison: 'periode manquante' };
  if (!s.pleinPerimetre) {
    return { ok: false, raison: 'périmètre filtré — un sous-total ne peut pas servir de référence' };
  }
  if (!(s.coutEmployeur > 0)) {
    // Zéro n'est pas « quinzaine vide » : l'écran affiche le total APRÈS
    // chargement, et un 0 signale un calcul non abouti. L'enregistrer écraserait
    // un instantané valide par un artefact de chargement.
    return { ok: false, raison: 'coût employeur nul ou négatif — calcul non abouti' };
  }
  if (!(s.jours > 0)) return { ok: false, raison: 'aucune journée pointée' };
  return { ok: true, raison: '' };
}

/**
 * Instantané → document Firestore. PURE (l'horodatage est INJECTÉ).
 *
 * `nowISO` et `auteur` sont des paramètres, jamais lus d'une horloge ou d'un
 * contexte global : c'est ce qui rend la fonction testable et le document
 * reproductible.
 *
 * @param {Object} snap sortie de `normaliser`, déjà validée.
 * @param {string} nowISO
 * @param {{uid?: string|null, profileId?: string, email?: string}} auteur
 * @returns {Object}
 */
function versDocument(snap, nowISO, auteur) {
  const a = auteur || {};
  return {
    periode: snap.periode,
    dateDebut: snap.dateDebut,
    dateFin: snap.dateFin,
    coutEmployeur: snap.coutEmployeur,
    netAPayer: snap.netAPayer,
    masseSalariale: snap.masseSalariale,
    jours: snap.jours,
    postes: snap.postes,
    sousPostes: snap.sousPostes,
    joursFeries: snap.joursFeries,
    population: snap.population,
    // Horodatage : sans lui, on ne peut pas dire si le chiffre affiché en face
    // de la grille date d'aujourd'hui ou d'avant la dernière correction de paie.
    enregistre_at: nowISO,
    enregistre_par: {
      uid: a.uid || null,
      profileId: a.profileId || '',
      email: a.email || '',
    },
  };
}

/**
 * Documents Firestore → map période → instantané, pour l'écran Campagne. PURE.
 *
 * @param {Array<Object>} docs
 * @returns {Object<string, Object>}
 */
function parPeriode(docs) {
  const out = {};
  (docs || []).forEach((d) => {
    if (!d || !d.periode) return;
    out[d.periode] = d;
  });
  return out;
}

module.exports = {
  POSTES,
  SOUS_POSTES,
  nombre,
  normaliser,
  valider,
  versDocument,
  parPeriode,
};
