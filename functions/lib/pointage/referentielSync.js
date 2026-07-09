'use strict';
// @ts-check

/**
 * referentielSync.js — Job de synchro du référentiel parcelle → ferme.
 *
 * docs/spec-referentiel-parcelle-ferme.md §4.2. Piggyback horaire sur runFullSync.
 *
 * Liste les ParcelleCulturale AVEC pointage dans la campagne active (BDP),
 * applique la règle pure `resolveFermeFromParcelle`, et UPSERT dans la collection
 * `parcelle_ferme_referentiel` (doc id `${campagne}__${ref_parcelle}`).
 *
 * Garanties :
 *   - Idempotent (upsert par clé), campagne-aware (doc distinct par campagne).
 *   - `source:'manual'` (override humain) JAMAIS écrasé par 'auto'.
 *   - `unresolved` → ferme:'INCONNU' + ajout à la liste d'alerte du meta +
 *     alerte WhatsApp DG (debounce 24h). Jamais de masquage silencieux (§6).
 *   - Enrobé try/catch par l'appelant : ne casse jamais runFullSync.
 *
 * Ce module ne fait PAS de I/O directe : SQL, Firestore et WhatsApp sont injectés
 * (testabilité + pas de couplage). CommonJS, pas de require '../public/...'.
 */

const { resolveFermeFromParcelle } = require('./refParcelleFerme');

/** Fenêtre de ré-alerte INCONNU : rappel au plus toutes les 24h. */
const ALERT_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

const REFERENTIEL_COLLECTION = 'parcelle_ferme_referentiel';
const META_DOC_PATH = { collection: 'parcelle_ferme_referentiel_meta', doc: 'state' };

/**
 * Requête BDP : parcelles DISTINCTES ayant du pointage dans la campagne @cmp.
 * Ancrage sur Pointage_ParcelleCulturale (lien pointage↔parcelle) filtré par
 * id_campagne. Jointure ParcelleCulturale (label/ref/variété/ferme).
 * Le label `Ref` peut varier légèrement d'un pointage à l'autre → on prend
 * MAX(pc.Ref) comme label représentatif (déterministe).
 */
const REFERENTIEL_SQL = `
  SELECT
    pc.Ref_parcelle                 AS ref_parcelle,
    MAX(pc.Ref)                     AS label,
    MAX(v.Variete)                  AS variete,
    MAX(pc.IDFermes)                AS idFermes,
    MIN(CONVERT(varchar(10), pt.DATE, 23)) AS first_seen
  FROM Pointage_ParcelleCulturale ppc
  INNER JOIN ParcelleCulturale pc ON pc.ID = ppc.ParcCul_ID
  INNER JOIN Pointage pt          ON pt.IDPointage = ppc.IDPointage
  LEFT  JOIN Variete v            ON pc.Variete = v.ID
  WHERE ppc.id_campagne = @cmp
    AND pc.Ref_parcelle IS NOT NULL
    AND LTRIM(RTRIM(pc.Ref_parcelle)) <> ''
  GROUP BY pc.Ref_parcelle
`;

/**
 * Résout l'ID SQL (Compagne.ID_compagne) de la campagne label 'AAAA-BBBB'.
 * Le label BDP est du style 'AAAA / BBBB' (espaces autour du slash). On
 * normalise en supprimant espaces et en unifiant les séparateurs.
 *
 * @param {{query:(sql:string)=>Promise<{recordset:Array<any>}>}} sqlRunner
 * @param {string} campagneLabel ex. '2026-2027'
 * @returns {Promise<number|null>} ID_compagne ou null si introuvable
 */
async function resolveCampagneId(sqlRunner, campagneLabel) {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '').replace(/\//g, '-');
  const target = norm(campagneLabel);
  const res = await sqlRunner.query('SELECT ID_compagne, Compagne FROM Compagne');
  const rows = (res && res.recordset) || [];
  for (const r of rows) {
    if (norm(r.Compagne) === target) return r.ID_compagne;
  }
  return null;
}

/**
 * Construit le payload d'upsert d'un doc référentiel à partir d'une ligne BDP,
 * en respectant la protection `source:'manual'`.
 *
 * @param {Object} row ligne BDP { ref_parcelle, label, variete, idFermes, first_seen }
 * @param {string} campagne libellé campagne
 * @param {Object|null} existing doc existant (ou null)
 * @param {(v:any)=>any} serverTimestamp fabrique de serverTimestamp
 * @returns {{docId:string, data:Object, unresolved:boolean, ferme:string}}
 */
function buildReferentielDoc(row, campagne, existing, serverTimestamp) {
  const ref = String(row.ref_parcelle == null ? '' : row.ref_parcelle).trim();
  const label = String(row.label == null ? '' : row.label).trim();
  const variete = String(row.variete == null ? '' : row.variete).trim();
  const docId = `${campagne}__${ref}`;

  const { ferme, confidence } = resolveFermeFromParcelle({
    refParcelle: ref,
    label,
    variete,
    idFermes: row.idFermes,
  });
  const unresolved = confidence === 'unresolved';
  const isManual = existing && existing.source === 'manual';

  // labels observés : union (jusqu'à 20, garde-fou).
  const prevLabels = (existing && Array.isArray(existing.labels)) ? existing.labels : [];
  const labels = label && !prevLabels.includes(label)
    ? prevLabels.concat([label]).slice(-20)
    : prevLabels;

  const data = {
    campagne,
    ref_parcelle: ref,
    labels,
    variete_dominante: variete || (existing && existing.variete_dominante) || '',
    first_seen: (existing && existing.first_seen) || row.first_seen || null,
    updated_at: serverTimestamp(),
  };

  if (isManual) {
    // Override humain : on NE touche PAS ferme/source/confidence. On rafraîchit
    // uniquement labels/variété/updated_at. La ferme retenue = celle du manual.
    data.source = 'manual';
    return { docId, data, unresolved: false, ferme: existing.ferme };
  }

  data.ferme = unresolved ? 'INCONNU' : ferme;
  data.confidence = confidence;
  data.source = 'auto';
  return { docId, data, unresolved, ferme: data.ferme };
}

/**
 * Décide s'il faut (ré)émettre l'alerte INCONNU, avec debounce 24h.
 * @param {Object|null} prevState état meta précédent (ou null)
 * @param {string[]} unresolvedRefs refs actuellement INCONNU (peut être vide)
 * @param {Date} now
 * @returns {{shouldAlert:boolean, reason:string}}
 */
function decideUnresolvedAlert(prevState, unresolvedRefs, now) {
  if (!unresolvedRefs || unresolvedRefs.length === 0) {
    return { shouldAlert: false, reason: 'none' };
  }
  const lastAlertAt = prevState && prevState.lastUnresolvedAlertAtMs;
  if (typeof lastAlertAt === 'number' && (now.getTime() - lastAlertAt) < ALERT_DEBOUNCE_MS) {
    return { shouldAlert: false, reason: 'debounced' };
  }
  return { shouldAlert: true, reason: 'new_or_stale' };
}

/**
 * Construit le message d'alerte WhatsApp INCONNU (SINGLE-LINE — cf. contrainte
 * template general_alert : pas de \n/tab/espaces multiples).
 * @param {string} campagne
 * @param {string[]} unresolvedRefs
 * @returns {string}
 */
function buildUnresolvedMessage(campagne, unresolvedRefs) {
  const list = unresolvedRefs.slice(0, 15).join(', ');
  const extra = unresolvedRefs.length > 15 ? ` (+${unresolvedRefs.length - 15})` : '';
  return `⚠️ Référentiel parcelle→ferme (${campagne}) : ${unresolvedRefs.length} parcelle(s) ACTIVE(s) non rattachée(s) à une ferme : ${list}${extra}. À corriger (override manuel ou label BEE ONE) — ces parcelles sont exclues des vues chef.`;
}

/**
 * Exécute la synchro du référentiel pour UNE campagne active.
 *
 * @param {Object} deps
 * @param {{query:(sql:string)=>Promise<{recordset:Array<any>}>, request:()=>any}} deps.sqlPool pool BDP (mssql)
 * @param {Object} deps.db instance Firestore admin
 * @param {Object} deps.admin firebase-admin (pour FieldValue.serverTimestamp)
 * @param {string} deps.campagne libellé campagne active ('2026-2027')
 * @param {Object} [deps.whatsapp] service WhatsApp (sendTemplateMessage, resolveRecipientsForProfile, toSingleLine)
 * @param {Function} [deps.invalidateCache] callback d'invalidation du cache runtime
 * @param {Date} [deps.now]
 * @returns {Promise<{success:boolean, campagne:string, total:number, unresolved:number, error?:string}>}
 */
async function syncReferentielParcelleFerme(deps) {
  const { sqlPool, db, admin, campagne, whatsapp, invalidateCache } = deps;
  const now = deps.now || new Date();
  const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

  const campagneId = await resolveCampagneId(sqlPool.request(), campagne);
  if (campagneId == null) {
    return { success: false, campagne, total: 0, unresolved: 0, error: `campagne '${campagne}' introuvable dans Compagne` };
  }

  const res = await sqlPool.request().input('cmp', campagneId).query(REFERENTIEL_SQL);
  const rows = (res && res.recordset) || [];

  const unresolvedRefs = [];
  let written = 0;

  // Upsert par doc (lecture existant pour protéger source:'manual').
  for (const row of rows) {
    const ref = String(row.ref_parcelle == null ? '' : row.ref_parcelle).trim();
    if (!ref) continue;
    const docId = `${campagne}__${ref}`;
    const docRef = db.collection(REFERENTIEL_COLLECTION).doc(docId);
    const snap = await docRef.get();
    const existing = snap.exists ? snap.data() : null;

    const built = buildReferentielDoc(row, campagne, existing, serverTimestamp);
    await docRef.set(built.data, { merge: true });
    written += 1;
    if (built.unresolved) unresolvedRefs.push(ref);
  }

  // Meta : compteurs + liste unresolved + debounce alerte.
  const metaRef = db.collection(META_DOC_PATH.collection).doc(META_DOC_PATH.doc);
  const metaSnap = await metaRef.get();
  const prevState = metaSnap.exists ? metaSnap.data() : null;

  const decision = decideUnresolvedAlert(prevState, unresolvedRefs, now);
  let alertSent = false;
  if (decision.shouldAlert && whatsapp) {
    try {
      const msg = whatsapp.toSingleLine
        ? whatsapp.toSingleLine(buildUnresolvedMessage(campagne, unresolvedRefs))
        : buildUnresolvedMessage(campagne, unresolvedRefs);
      const recipients = await whatsapp.resolveRecipientsForProfile('dg', null);
      if (recipients && recipients.length) {
        for (const r of recipients) {
          await whatsapp.sendTemplateMessage(r.phone, 'general_alert', [msg]);
        }
        alertSent = true;
      } else {
        console.error('[referentiel] alerte INCONNU non envoyée : aucun destinataire DG');
      }
    } catch (e) {
      console.error('[referentiel] échec envoi alerte INCONNU:', e.message);
    }
  }

  const metaState = {
    campagne,
    lastSyncAt: serverTimestamp(),
    totalParcelles: written,
    unresolvedCount: unresolvedRefs.length,
    unresolvedRefs,
  };
  if (alertSent) metaState.lastUnresolvedAlertAtMs = now.getTime();
  else if (prevState && typeof prevState.lastUnresolvedAlertAtMs === 'number') {
    metaState.lastUnresolvedAlertAtMs = prevState.lastUnresolvedAlertAtMs;
  }
  await metaRef.set(metaState, { merge: true });

  if (unresolvedRefs.length) {
    console.warn(`[referentiel] ${campagne} : ${unresolvedRefs.length} parcelle(s) active(s) INCONNU: ${unresolvedRefs.join(', ')}`);
  }

  if (typeof invalidateCache === 'function') {
    try { invalidateCache(); } catch (_) { /* best-effort */ }
  }

  return { success: true, campagne, total: written, unresolved: unresolvedRefs.length };
}

module.exports = {
  syncReferentielParcelleFerme,
  buildReferentielDoc,
  decideUnresolvedAlert,
  buildUnresolvedMessage,
  resolveCampagneId,
  REFERENTIEL_SQL,
  REFERENTIEL_COLLECTION,
  ALERT_DEBOUNCE_MS,
};
