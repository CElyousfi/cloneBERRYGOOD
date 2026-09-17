/**
 * bdcVirementService.js — Core virement state transitions for BDC.
 *
 * Callable from:
 *  - HTTP endpoint (action=update-bdc-virement in functions/index.js)
 *  - WhatsApp bot (functions/src/modules/magasin/chefBdcBot.js)
 *
 * Decision flow:
 *   valide_dg ── decision="lancer"  ──▶ virement_lance  (Finance saisit le virement)
 *   virement_lance ── decision="signer" ─▶ virement_signe (DG signe)
 */

const { db } = require("../../../config/firebase");
const { dispatchNotification } = require("../admin/notificationDispatcher");

/**
 * Apply a virement state transition.
 *
 * @param {object} payload
 * @param {string} payload.id          - BDC id
 * @param {"lancer"|"signer"} payload.decision
 * @param {object} [payload.by]        - { profileId, name } actor record
 * @param {string} [payload.via]       - "dashboard" | "whatsapp" (audit only)
 * @returns {Promise<{success:boolean,error?:string,statusCode?:number,currentStatus?:string}>}
 */
async function updateBdcVirementCore({ id, decision, by, via }) {
  if (!id || !decision) {
    return { success: false, statusCode: 400, error: "id et decision requis" };
  }
  const docRef = db.collection("purchase_orders").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return { success: false, statusCode: 404, error: "BDC non trouvé" };
  const current = doc.data();

  if (current.mode_paiement !== "comptant_virement" && current.mode_paiement !== "virement_bancaire") {
    return { success: false, statusCode: 400, error: "Ce BDC n'est pas payé par virement bancaire" };
  }

  const history = current.history || [];
  const now = Date.now();
  // Firestore rejette les valeurs `undefined` (ignoreUndefinedProperties non activé).
  // Les acteurs WhatsApp peuvent fournir un `by` avec des champs absents (ex. profileId
  // ou email undefined) ; on défaute explicitement avant le spread pour éviter qu'un
  // `undefined` ne se retrouve dans history[].by ou virement_*_by.
  const byClean = by && typeof by === "object" ? by : {};
  const actor = {
    profileId: byClean.profileId || "",
    name: byClean.name || "",
    email: byClean.email || "",
    uid: byClean.uid || "",
    via: via || "dashboard",
  };

  if (decision === "lancer") {
    if (current.status !== "valide_dg") {
      return { success: false, statusCode: 400, error: "Le BDC doit être en statut Validé DG", currentStatus: current.status };
    }
    history.push({ action: "virement_lance", by: actor, at: now, comment: "" });
    await docRef.update({
      status: "virement_lance",
      virement_lance_by: actor,
      virement_lance_at: now,
      history,
      updated_at: now,
    });
    dispatchNotification({
      type: "bdc_virement_launched", profiles: ["finance", "dg", "achats"],
      data: {
        numero: current.numero || id,
        bdc_id: id,
        fournisseur: (current.fournisseur && current.fournisseur.nom) || current.supplier_name || "Fournisseur",
        montant: current.total_ttc ? `${current.total_ttc} MAD` : "Non précisé",
        pdf_url: current.pdf_url || null,
        message: `Virement lancé pour BDC ${current.numero || id}, en attente signature DG`,
      },
      relatedDoc: `purchase_orders/${id}`,
      ...(current.pdf_url ? { document: { link: current.pdf_url, filename: `BDC_${current.numero || id}.pdf` } } : {}),
    }).catch(err => console.error("WhatsApp dispatch error:", err));
    return { success: true };
  }

  if (decision === "signer") {
    if (current.status !== "virement_lance") {
      return { success: false, statusCode: 400, error: "Le BDC doit être en statut Virement Lancé", currentStatus: current.status };
    }
    history.push({ action: "virement_signe", by: actor, at: now, comment: "" });
    await docRef.update({
      status: "virement_signe",
      virement_signe_by: actor,
      virement_signe_at: now,
      history,
      updated_at: now,
    });
    dispatchNotification({
      type: "bdc_virement_signed", profiles: ["achats", "finance"],
      data: { numero: current.numero || id, bdc_id: id, message: `Virement signé pour BDC ${current.numero || id}` },
      relatedDoc: `purchase_orders/${id}`,
    }).catch(err => console.error("WhatsApp dispatch error:", err));
    return { success: true };
  }

  return { success: false, statusCode: 400, error: "Decision invalide (lancer|signer)" };
}

/**
 * Record the uploaded "avis de virement" PDF and notify Achats with the PDF
 * attached.
 *
 * @param {object} payload
 * @param {string} payload.id
 * @param {string} payload.avis_pdf_url  - HTTPS URL to PDF (Storage signed)
 * @param {object} [payload.uploaded_by] - { profileId, name }
 * @returns {Promise<{success:boolean,error?:string,statusCode?:number}>}
 */
async function recordVirementAvis({ id, avis_pdf_url, uploaded_by }) {
  if (!id || !avis_pdf_url) {
    return { success: false, statusCode: 400, error: "id et avis_pdf_url requis" };
  }
  const docRef = db.collection("purchase_orders").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return { success: false, statusCode: 404, error: "BDC non trouvé" };
  const current = doc.data();
  if (current.status !== "virement_signe" && current.status !== "envoye") {
    return { success: false, statusCode: 400, error: "L'avis ne peut être joint qu'après signature du virement", currentStatus: current.status };
  }

  const history = current.history || [];
  const now = Date.now();
  history.push({
    action: "avis_virement_uploaded",
    by: uploaded_by || {},
    at: now,
    comment: "Avis de virement joint",
  });
  await docRef.update({
    avis_virement_url: avis_pdf_url,
    avis_virement_uploaded_at: now,
    avis_virement_uploaded_by: uploaded_by || null,
    history,
    updated_at: now,
  });

  // Notify Achats with the PDF
  dispatchNotification({
    type: "bdc_avis_virement", profiles: ["achats"],
    data: {
      numero: current.numero || id,
      bdc_id: id,
      supplier: (current.fournisseur && current.fournisseur.nom) || current.supplier_name || "Fournisseur",
      pdf_url: avis_pdf_url,
      message: `Avis de virement disponible pour BDC ${current.numero || id}`,
    },
    relatedDoc: `purchase_orders/${id}`,
  }).catch(err => console.error("WhatsApp dispatch error:", err));

  return { success: true };
}

module.exports = { updateBdcVirementCore, recordVirementAvis };
