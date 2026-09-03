/**
 * campagneRapportHebdo/envois — logique PURE du rapport Campagne hebdomadaire :
 * qui reçoit quoi, et comment on juge qu'un envoi a réussi.
 *
 * Aucun accès Firestore, aucun appel réseau : tout est injecté. C'est ce qui
 * rend la matrice de diffusion et la règle de succès testables sans émulateur.
 */
// @ts-check
'use strict';

/**
 * @typedef {Object} Destinataire
 * @property {string} phone      E.164 (déjà normalisé par resolveRecipientsForProfile)
 * @property {string} [displayName]
 * @property {string} [uid]
 */

/**
 * @typedef {Object} Envoi
 * @property {string} culture
 * @property {string} phone
 * @property {string} profileId  profil qui a fait entrer la personne dans la liste
 * @property {string} displayName
 */

/**
 * Croise la matrice de diffusion et les destinataires résolus par profil.
 *
 * DÉDOUBLONNAGE PAR (culture, téléphone) — et pas par téléphone seul : une
 * personne qui porte deux profils de la matrice (ex. dg + rh) ne doit pas
 * recevoir DEUX fois le même classeur, mais doit bien recevoir les DEUX
 * cultures. Dédoublonner par téléphone seul lui volerait la moitié du rapport ;
 * ne pas dédoublonner du tout lui enverrait 4 messages au lieu de 2.
 *
 * @param {{audience: Record<string, ReadonlyArray<string>>,
 *          recipientsByProfile: Record<string, Array<Destinataire>>}} params
 * @returns {Array<Envoi>} ordre déterministe : cultures puis profils dans
 *   l'ordre de la matrice. Le `profileId` retenu est celui du PREMIER profil
 *   qui a amené la personne (information de traçabilité, pas de routage).
 */
function buildEnvois(params) {
  const audience = (params && params.audience) || {};
  const recipientsByProfile = (params && params.recipientsByProfile) || {};
  /** @type {Array<Envoi>} */
  const envois = [];
  const vus = new Set();

  Object.keys(audience).forEach((culture) => {
    const profils = audience[culture] || [];
    profils.forEach((profileId) => {
      const recipients = recipientsByProfile[profileId] || [];
      recipients.forEach((r) => {
        const phone = r && r.phone ? String(r.phone).trim() : '';
        if (!phone) return;
        const cle = culture + '|' + phone;
        if (vus.has(cle)) return;
        vus.add(cle);
        envois.push({
          culture: culture,
          phone: phone,
          profileId: profileId,
          displayName: (r && r.displayName) || '',
        });
      });
    });
  });

  return envois;
}

/**
 * @typedef {Object} ResultatEnvoi
 * @property {string} phone
 * @property {string} profileId
 * @property {string} [displayName]
 * @property {boolean} success
 * @property {string} [error]
 */

/**
 * @typedef {Object} ResultatCulture
 * @property {string} culture
 * @property {'ok'|'error'} status  'error' = classeur ou upload impossible
 * @property {string} [error]
 * @property {Array<ResultatEnvoi>} [envois]
 * @property {Array<string>} [profilsManquants] profils de la matrice pour
 *   lesquels AUCUN destinataire n'a été résolu
 */

/**
 * Juge la campagne d'envoi et rédige le texte de l'alerte.
 *
 * ⚠️ LE SUCCÈS SE MESURE AUX HUMAINS ATTEINTS. Une culture dont AUCUN
 * destinataire n'a été résolu (profils sans `whatsappPhone`, ou
 * `whatsappEnabled: false`) est un ÉCHEC, pas un succès à vide : l'opération
 * de canal a « réussi » sans servir personne, ce qui ne prouve rien et laisse
 * la panne invisible jusqu'au lundi suivant.
 *
 * @param {Array<ResultatCulture>} resultats
 * @param {{erreursResolution?: Array<{profileId: string, error: string}>}} [options]
 *   Erreurs rencontrées en LISANT les destinataires (Firestore injoignable).
 *   Sans elles, une panne d'infrastructure se raconte comme « personne n'a de
 *   whatsappPhone » et envoie chercher au mauvais endroit.
 * @returns {{alerte: boolean, texte: string, totalEnvoyes: number,
 *            totalEchecs: number, culturesEnEchec: Array<string>}}
 */
function resumeEnvois(resultats, options) {
  const liste = Array.isArray(resultats) ? resultats : [];
  const erreursResolution = (options && Array.isArray(options.erreursResolution))
    ? options.erreursResolution : [];
  const problemes = [];
  if (erreursResolution.length > 0) {
    problemes.push(
      'lecture des destinataires en ÉCHEC pour '
      + erreursResolution.map((e) => e.profileId).join('/')
      + ' (' + (erreursResolution[0].error || 'erreur inconnue')
      + ') — panne d\'accès aux données, PAS une configuration users à corriger'
    );
  }
  const succes = [];
  const culturesEnEchec = [];
  let totalEnvoyes = 0;
  let totalEchecs = 0;

  if (liste.length === 0) {
    problemes.push('aucune culture traitée');
    return {
      alerte: true,
      texte: 'Rapport Campagne hebdo INCOMPLET — ' + problemes.join(' ; ') + '.',
      totalEnvoyes: 0,
      totalEchecs: 0,
      culturesEnEchec: [],
    };
  }

  liste.forEach((r) => {
    const culture = (r && r.culture) || '?';
    const envois = (r && Array.isArray(r.envois)) ? r.envois : [];
    const envoyes = envois.filter((e) => e && e.success);
    const rates = envois.filter((e) => !e || !e.success);
    totalEnvoyes += envoyes.length;
    totalEchecs += rates.length;

    if (r && r.status === 'error') {
      culturesEnEchec.push(culture);
      problemes.push(culture + ' — rapport non produit : ' + (r.error || 'erreur inconnue'));
      return;
    }
    const manquants = (r && Array.isArray(r.profilsManquants)) ? r.profilsManquants : [];
    if (envois.length === 0) {
      // Zéro destinataire résolu : succès à vide = ÉCHEC.
      culturesEnEchec.push(culture);
      problemes.push(
        culture + ' — AUCUN destinataire joignable (0 envoi'
        + (manquants.length ? ', profils ' + manquants.join('/') : '')
        + ') : vérifier whatsappPhone / whatsappEnabled dans users'
      );
      return;
    }
    if (rates.length > 0) {
      culturesEnEchec.push(culture);
      const details = rates
        .map((e) => nommer(e) + ' : ' + ((e && e.error) || 'erreur inconnue'))
        .join(', ');
      problemes.push(
        culture + ' — ' + envoyes.length + '/' + envois.length + ' envoyés, échec pour ' + details
      );
      return;
    }
    if (manquants.length > 0) {
      // Tous les messages émis sont partis, mais un profil ENTIER de la matrice
      // n'a personne de joignable : le chef concerné ne recevra jamais son
      // rapport et, sans cette alerte, personne ne le saurait.
      culturesEnEchec.push(culture);
      problemes.push(
        culture + ' — ' + envoyes.length + ' envoyés mais AUCUN destinataire pour le(s) profil(s) '
        + manquants.join('/') + ' : vérifier whatsappPhone / whatsappEnabled dans users'
      );
      return;
    }
    succes.push(culture + ' ' + envoyes.length + '/' + envois.length);
  });

  if (problemes.length === 0) {
    return {
      alerte: false,
      texte: 'Rapport Campagne hebdo envoyé — ' + succes.join(', ') + '.',
      totalEnvoyes: totalEnvoyes,
      totalEchecs: totalEchecs,
      culturesEnEchec: culturesEnEchec,
    };
  }

  const suffixe = succes.length > 0 ? ' OK : ' + succes.join(', ') + '.' : '';
  return {
    alerte: true,
    texte: 'Rapport Campagne hebdo INCOMPLET — ' + problemes.join(' ; ') + '.' + suffixe,
    totalEnvoyes: totalEnvoyes,
    totalEchecs: totalEchecs,
    culturesEnEchec: culturesEnEchec,
  };
}

/**
 * Nomme un destinataire dans l'alerte : une alerte anonyme (« 1 échec ») ne
 * permet pas d'agir, il faut savoir QUI n'a pas été servi.
 * @param {ResultatEnvoi} e
 * @returns {string}
 */
function nommer(e) {
  if (!e) return 'destinataire inconnu';
  const nom = e.displayName || e.phone || 'destinataire inconnu';
  return e.profileId ? nom + ' (' + e.profileId + ')' : nom;
}

/**
 * Le classeur contient une feuille « Synthèse » + une feuille par parcelle
 * (cf. lib/campagneExport/buildWorkbook) : le nombre de parcelles annoncé dans
 * le message est donc `nbFeuilles - 1`.
 * @param {number} nbFeuilles
 * @returns {number}
 */
function nbParcellesFromFeuilles(nbFeuilles) {
  const n = Number(nbFeuilles);
  if (!isFinite(n) || n <= 1) return 0;
  return n - 1;
}

/**
 * Date au format jj/mm/aaaa dans le fuseau du cron (le lundi de l'envoi).
 * @param {Date} date
 * @param {string} [timeZone]
 * @returns {string}
 */
function formatDateLabel(date, timeZone) {
  const d = date instanceof Date ? date : new Date();
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: timeZone || 'Africa/Casablanca',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Paramètres du corps du template `campagne_rapport_hebdo` :
 *   « SmartBerry — Rapport Campagne {{1}} du {{2}}. {{3}} parcelles. … »
 * @param {{culture: string, dateLabel: string, nbParcelles: number}} params
 * @returns {Array<string>}
 */
function buildBodyParams(params) {
  /** @type {any} */ // le `|| {}` defensif efface la forme documentee par le @param ci-dessus
  const p = params || {};
  return [String(p.culture || ''), String(p.dateLabel || ''), String(p.nbParcelles == null ? 0 : p.nbParcelles)];
}

module.exports = {
  buildEnvois,
  resumeEnvois,
  nbParcellesFromFeuilles,
  formatDateLabel,
  buildBodyParams,
};
