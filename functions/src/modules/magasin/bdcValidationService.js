/**
 * bdcValidationService.js — Core BDC approval logic, callable from:
 *  - HTTP endpoint (action=validate-bdc in functions/index.js)
 *  - WhatsApp bot (functions/src/modules/magasin/chefBdcBot.js)
 *
 * Returns { success, error?, statusCode? } and triggers downstream WhatsApp
 * notifications (chef approved / rejected / dg approved / ...).
 */

const { db } = require("../../../config/firebase");
const { dispatchNotification } = require("../admin/notificationDispatcher");

/**
 * Validate (approve/reject) a BDC.
 *
 * @param {object} payload
 * @param {string} payload.id        - BDC id
 * @param {"approve"|"reject"} payload.decision
 * @param {"chef"|"dg"} payload.role
 * @param {string} [payload.profileId]
 * @param {string} [payload.name]
 * @param {string} [payload.comment]
 * @param {string} [payload.ferme]   - Validator farm (for chef role)
 * @param {string} [payload.via]     - "dashboard" | "whatsapp" (audit only)
 * @returns {Promise<{success:boolean,error?:string,statusCode?:number,currentStatus?:string}>}
 */
async function validateBdcCore({ id, decision, role, profileId, name, comment, ferme: validatorFerme, via }) {
  if (!id || !decision || !role) {
    return { success: false, statusCode: 400, error: "id, decision (approve/reject), role requis" };
  }

  const docRef = db.collection("purchase_orders").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return { success: false, statusCode: 404, error: "BDC non trouvé" };
  const current = doc.data();

  const visa = {
    profileId: profileId || role,
    name: name || role,
    at: Date.now(),
    comment: comment || "",
    via: via || "dashboard",
  };
  const history = current.history || [];

  if (role === "chef") {
    if (current.status !== "en_attente_chef") {
      return { success: false, statusCode: 400, error: "Ce BDC n'est pas en attente de validation Chef", currentStatus: current.status };
    }
    if (validatorFerme && current.ferme !== validatorFerme) {
      return { success: false, statusCode: 403, error: "Vous ne pouvez valider que les BDC de votre ferme" };
    }
    if (decision === "approve") {
      history.push({ action: "validation_chef", by: visa, at: Date.now(), comment: comment || "" });
      await docRef.update({
        status: "en_attente_dg", validated_by_chef: visa, history, updated_at: Date.now(),
      });
      const useDoc = !!current.pdf_url;
      try {
        await dispatchNotification({
          type: useDoc ? "bdc_chef_approved_doc" : "bdc_chef_approved",
          profiles: ["dg", "achats"],
          data: {
            numero: current.numero || id,
            bdc_id: id,
            message: `BDC ${current.numero || id} validé par Chef, en attente DG`,
          },
          relatedDoc: `purchase_orders/${id}`,
          ...(useDoc ? { document: { link: current.pdf_url, filename: `BDC_${current.numero || id}.pdf` } } : {}),
        });
      } catch (err) {
        console.error("WhatsApp dispatch error:", err);
      }
    } else {
      history.push({ action: "rejet_chef", by: visa, at: Date.now(), comment: comment || "" });
      await docRef.update({ status: "rejete", history, updated_at: Date.now() });
      try {
        await dispatchNotification({
          type: "bdc_rejected", profiles: ["achats"],
          data: { numero: current.numero || id, motif: comment || "Rejeté par Chef", message: `BDC ${current.numero || id} rejeté par Chef` },
          relatedDoc: `purchase_orders/${id}`,
        });
      } catch (err) {
        console.error("WhatsApp dispatch error:", err);
      }
    }
    return { success: true };
  }

  if (role === "dg") {
    if (current.status !== "en_attente_dg") {
      return { success: false, statusCode: 400, error: "Ce BDC n'est pas en attente de validation DG", currentStatus: current.status };
    }
    if (decision === "approve") {
      const now = Date.now();
      const isVirementMode = current.mode_paiement === "comptant_virement" || current.mode_paiement === "virement_bancaire";
      history.push({ action: "validation_dg", by: visa, at: now, comment: comment || "" });
      const update = { status: "valide_dg", validated_by_dg: visa, history, updated_at: now };
      if (isVirementMode) {
        history.push({ action: "transmission_finance", by: { profileId: "system", name: "Système" }, at: now, comment: "BDC transmis à Finance pour lancement du virement" });
        update.notified_finance = true;
        update.notified_finance_at = now;
      }
      await docRef.update(update);
      const targetProfiles = isVirementMode ? ["achats", "finance"] : ["achats"];
      try {
        await dispatchNotification({
          type: "bdc_dg_approved", profiles: targetProfiles,
          data: {
            numero: current.numero || id,
            description: current.description || current.items?.[0]?.designation || "Aucune description",
            montant: current.total_ttc ? `${current.total_ttc} MAD` : "Non précisé",
            message: `BDC ${current.numero || id} approuvé par DG`,
          },
          relatedDoc: `purchase_orders/${id}`,
        });
      } catch (err) {
        console.error("WhatsApp dispatch error:", err);
      }
    } else {
      history.push({ action: "rejet_dg", by: visa, at: Date.now(), comment: comment || "" });
      await docRef.update({ status: "rejete", history, updated_at: Date.now() });
      try {
        await dispatchNotification({
          type: "bdc_rejected", profiles: ["achats"],
          data: { numero: current.numero || id, motif: comment || "Rejeté par DG", message: `BDC ${current.numero || id} rejeté par DG` },
          relatedDoc: `purchase_orders/${id}`,
        });
      } catch (err) {
        console.error("WhatsApp dispatch error:", err);
      }
    }
    return { success: true };
  }

  return { success: false, statusCode: 400, error: "Rôle inconnu: " + role };
}

module.exports = { validateBdcCore };
