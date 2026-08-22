/*
 * fichierPaieStore.js — CONSERVATION du fichier de paie d'une quinzaine. PURE.
 *
 * Le responsable RH dépose son classeur une seule fois ; le rapprochement reste
 * ensuite disponible pour tout le monde, sans redéposer.
 *
 * ── CE QU'ON CONSERVE, ET SURTOUT CE QU'ON NE CONSERVE PAS ─────────────────
 * Le classeur contient une feuille VIREMENT avec les RIB et les noms de 250
 * personnes. Rien de tout cela n'entre ici : le module ne stocke que ce que le
 * rapprochement exploite — MATRICULE, journées, fériés, ancienneté, primes,
 * montants — feuille par feuille. Ni nom, ni RIB, ni le classeur lui-même.
 *
 * Décision d'Omar, 2026-08-22. Ce n'est pas une précaution abstraite : une donnée
 * bancaire conservée devient une responsabilité permanente, et le rapprochement
 * n'en a aucun besoin. `lireFeuilleOuvriers` n'extrait d'ailleurs même pas la
 * colonne « Personnel » — l'absence de nom est structurelle, pas un filtre qu'on
 * pourrait oublier d'appliquer.
 *
 * ── POURQUOI VALIDER AUSSI SÉVÈREMENT ─────────────────────────────────────
 * Ce document devient la référence « fichier de paie » pour tout le monde. Un
 * import partiel — une feuille mal lue, un total à zéro — s'y installerait
 * durablement et ferait apparaître des écarts imputés à Smart Berry. Mieux vaut
 * refuser un import et le dire que conserver un fichier à moitié lu.
 */
// @ts-check
'use strict';

/**
 * Nombre de lignes d'ouvriers au-delà duquel on refuse l'import.
 *
 * Un document Firestore plafonne à 1 Mo. À ~200 octets par ligne, 4 000 lignes
 * pèsent ~800 Ko : la marge est mince mais réelle, et les quinzaines observées
 * en comptent 210. Au-delà, ce n'est pas une quinzaine — c'est un autre fichier.
 */
const MAX_LIGNES = 4000;

/** Champs conservés par ligne d'ouvrier. Toute autre clé est écartée. */
const CHAMPS_LIGNE = [
  'matricule', 'jours', 'feries', 'anciennete', 'primeFonctionBrut',
  'montantBrut', 'montantNet', 'equipe',
];

/** @param {*} v @returns {number} */
function nombre(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/** @param {*} v @returns {string} */
function texte(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

/**
 * Normalise UNE ligne d'ouvrier. PURE.
 *
 * Liste blanche stricte : le client envoie ce qu'il veut, et un champ inattendu
 * qui survivrait — un nom, par exemple — deviendrait une donnée conservée que
 * personne n'a décidé de conserver.
 *
 * @param {Object} l
 * @param {string} feuille 'POINTAGE' ou 'SANS CNSS'.
 * @returns {Object|null} `null` si la ligne n'a pas de matricule exploitable.
 */
function normaliserLigne(l, feuille) {
  const src = l || {};
  const matricule = texte(src.matricule).replace(/[^0-9]/g, '');
  if (!matricule) return null;
  const out = { matricule: matricule, feuille: feuille };
  CHAMPS_LIGNE.forEach((k) => {
    if (k === 'matricule') return;
    if (k === 'equipe') { out.equipe = texte(src.equipe); return; }
    out[k] = nombre(src[k]);
  });
  return out;
}

/**
 * Normalise un import reçu du client. PURE.
 *
 * @param {Object} brut corps de la requête.
 * @returns {Object}
 */
function normaliser(brut) {
  const b = brut || {};
  const lignes = [];
  [['POINTAGE', b.pointage], ['SANS CNSS', b.sansCnss]].forEach(([feuille, src]) => {
    (Array.isArray(src) ? src : []).forEach((l) => {
      const n = normaliserLigne(l, feuille);
      if (n) lignes.push(n);
    });
  });

  const st = b.sousTraitance;
  return {
    periode: texte(b.periode),
    dateDebut: texte(b.dateDebut),
    dateFin: texte(b.dateFin),
    // Le NOM DU FICHIER, pour que le RH sache lequel a été importé — mais il ne
    // sert jamais à identifier la quinzaine : macOS encode les accents en NFD,
    // et deux quinzaines ont déjà été interverties par un nom de fichier.
    nomFichier: texte(b.nomFichier).slice(0, 200),
    lignes: lignes,
    transport: nombre(b.transport),
    // `null` distinct de 0 : « feuille non lue » n'est pas « aucune
    // sous-traitance ». Conserver un 0 ferait apparaître un écart durable.
    sousTraitance: (st === null || st === undefined) ? null : nombre(st),
  };
}

/**
 * Totaux recalculés DEPUIS les lignes conservées. PURE.
 *
 * On ne fait pas confiance aux totaux envoyés par le client : ce qui fait foi,
 * c'est ce qu'on stocke. Recalculer garantit que le document est cohérent avec
 * lui-même, et qu'un total ne peut pas survivre à des lignes qui auraient été
 * écartées à la normalisation.
 *
 * @param {Array<Object>} lignes
 * @returns {Object}
 */
function totaux(lignes) {
  const out = { effectif: 0, jours: 0, feries: 0, anciennete: 0,
    primeFonctionBrut: 0, brut: 0, net: 0, declares: 0, nonDeclares: 0 };
  const vus = { 'POINTAGE': new Set(), 'SANS CNSS': new Set() };
  (lignes || []).forEach((l) => {
    if (!l) return;
    out.effectif += 1;
    out.jours += nombre(l.jours);
    out.feries += nombre(l.feries);
    out.anciennete += nombre(l.anciennete);
    out.primeFonctionBrut += nombre(l.primeFonctionBrut);
    out.brut += nombre(l.montantBrut);
    out.net += nombre(l.montantNet);
    if (vus[l.feuille]) vus[l.feuille].add(l.matricule);
  });
  out.declares = vus['POINTAGE'].size;
  out.nonDeclares = vus['SANS CNSS'].size;
  // MIXTES : présents sur les deux feuilles. Une partie de leurs journées est
  // déclarée, l'autre non — alors que Smart Berry leur attribue un statut unique
  // pour toute la quinzaine. C'est la piste du résidu qui reste à expliquer, et
  // elle ne se lit QUE dans le détail par ouvrier.
  out.mixtes = [...vus['POINTAGE']].filter((m) => vus['SANS CNSS'].has(m)).length;
  return out;
}

/**
 * Dit si un import mérite d'être conservé. PURE.
 *
 * Rend la RAISON : un refus muet laisserait le RH redéposer indéfiniment le même
 * fichier sans savoir ce qui cloche.
 *
 * @param {Object} imp sortie de `normaliser`.
 * @returns {{ok: boolean, raison: string}}
 */
function valider(imp) {
  const i = imp || {};
  if (!i.periode) return { ok: false, raison: 'période manquante' };
  if (!i.dateDebut || !i.dateFin) {
    return { ok: false, raison: 'dates de quinzaine illisibles dans la feuille' };
  }
  if (!i.lignes || !i.lignes.length) {
    return { ok: false, raison: 'aucune ligne d\'ouvrier lue — feuilles POINTAGE / SANS CNSS vides ou illisibles' };
  }
  if (i.lignes.length > MAX_LIGNES) {
    return { ok: false, raison: i.lignes.length + ' lignes : au-delà de ' + MAX_LIGNES
      + ', ce n\'est pas une quinzaine' };
  }
  const t = totaux(i.lignes);
  if (!(t.net > 0)) {
    // Un net nul avec des lignes présentes signale une colonne mal lue — pas une
    // quinzaine sans paie. Le conserver installerait un écart permanent.
    return { ok: false, raison: 'net total nul — la colonne « Montant Net » a-t-elle été lue ?' };
  }
  if (!(t.jours > 0)) return { ok: false, raison: 'aucune journée travaillée' };
  return { ok: true, raison: '' };
}

/**
 * Import → document Firestore. PURE (horodatage et auteur INJECTÉS).
 *
 * @param {Object} imp sortie de `normaliser`, déjà validée.
 * @param {string} nowISO
 * @param {{uid?: string|null, profileId?: string, email?: string}} auteur
 * @returns {Object}
 */
function versDocument(imp, nowISO, auteur) {
  const a = auteur || {};
  return {
    periode: imp.periode,
    dateDebut: imp.dateDebut,
    dateFin: imp.dateFin,
    nomFichier: imp.nomFichier,
    transport: imp.transport,
    sousTraitance: imp.sousTraitance,
    totaux: totaux(imp.lignes),
    lignes: imp.lignes,
    importe_at: nowISO,
    importe_par: {
      uid: a.uid || null,
      profileId: a.profileId || '',
      email: a.email || '',
    },
  };
}

/**
 * Documents → forme attendue par le rapprochement, indexée par période. PURE.
 *
 * Reconstitue les champs que `postesExcel` produirait, pour que l'écran compare
 * un fichier STOCKÉ exactement comme un fichier fraîchement déposé — un seul
 * chemin de comparaison, donc un seul comportement à vérifier.
 *
 * @param {Array<Object>} docs
 * @returns {Object<string, Object>}
 */
function parPeriode(docs) {
  const out = {};
  (docs || []).forEach((d) => {
    if (!d || !d.periode) return;
    const t = d.totaux || totaux(d.lignes);
    out[d.periode] = {
      periode: d.periode,
      dateDebut: d.dateDebut,
      dateFin: d.dateFin,
      nomFichier: d.nomFichier,
      importe_at: d.importe_at,
      importe_par: d.importe_par,
      postes: {
        jours: t.jours,
        feries: t.feries,
        anciennete: t.anciennete,
        primeFonctionBrut: t.primeFonctionBrut,
        brut: t.brut,
        net: t.net,
        transport: nombre(d.transport),
        sousTraitance: (d.sousTraitance === null || d.sousTraitance === undefined)
          ? null : nombre(d.sousTraitance),
        effectifDeclaresPurs: nombre(t.declares) - nombre(t.mixtes),
        effectifNonDeclaresPurs: nombre(t.nonDeclares) - nombre(t.mixtes),
        mixtes: new Array(nombre(t.mixtes)).fill(''),
      },
    };
  });
  return out;
}

module.exports = {
  MAX_LIGNES,
  CHAMPS_LIGNE,
  normaliserLigne,
  normaliser,
  totaux,
  valider,
  versDocument,
  parPeriode,
};
