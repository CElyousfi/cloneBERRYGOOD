/**
 * notificationDispatcher.js — Unified notification dispatcher.
 *
 * Orchestrates sending notifications across multiple channels:
 * - In-app alerts (Firestore `alerts` collection)
 * - WhatsApp (Meta Cloud API via whatsappService)
 *
 * All dispatches are fire-and-forget to avoid blocking API responses.
 */

const { db } = require("../../../config/firebase");
const whatsapp = require("./whatsappService");
// chefBdcBot is required lazily inside sendWhatsAppToProfiles to avoid a
// circular dependency (chefBdcBot → bdcValidationService → notificationDispatcher).

/**
 * Template mapping: notification type → WhatsApp template name + param builder.
 * Each entry maps a notification type to:
 *   - template: the registered Meta template name
 *   - params: function(data) → array of string values for template body params
 */
const TEMPLATE_MAP = {
  bdc_submit: {
    // v2 : ancien "bdc_validation_needed" supprimé (limite Meta 1 edit/24h),
    // recréé sous nouveau nom avec body 4 champs (fournisseur/montant/articles).
    template: "bdc_validation_needed_v2",
    params: (d) => [d.numero || "—", d.fournisseur || "—", d.montant || "Non précisé", d.articles || "—"],
  },
  bdc_submit_doc: {
    template: "bdc_validation_needed_doc",
    supportsDocument: true,
    params: (d) => [d.numero || "—", d.fournisseur || "—", d.montant || "Non précisé", d.articles || "—"],
  },
  bdc_chef_approved: {
    template: "bdc_chef_approved",
    params: (d) => [d.numero || "—"],
  },
  bdc_chef_approved_doc: {
    template: "bdc_chef_approved_doc",
    supportsDocument: true,
    params: (d) => [d.numero || "—"],
  },
  bdc_dg_approved: {
    template: "bdc_dg_approved",
    params: (d) => [d.numero || "—", d.description || "Aucune description", d.montant || "Non précisé"],
  },
  bdc_rejected: {
    template: "bdc_rejected",
    params: (d) => [d.numero || "—", d.motif || "Aucun motif précisé"],
  },
  bdc_sent_to_supplier: {
    template: "bdc_sent_to_supplier",
    params: (d) => [d.numero || "—", d.supplier || "Fournisseur inconnu"],
  },
  bdc_virement_launched: {
    template: "bdc_virement_update",
    params: (d) => [d.numero || "—", "Virement lancé"],
  },
  bdc_virement_signed: {
    template: "bdc_virement_update",
    params: (d) => [d.numero || "—", "Virement signé"],
  },
  pointage_validation: {
    template: "pointage_validation_needed",
    params: (d) => [d.date || "—", d.ferme || "—"],
  },
  quality_alert: {
    template: "quality_alert",
    params: (d) => [d.message || "Nouvelle alerte qualité"],
  },
  general_alert: {
    template: "general_alert",
    params: (d) => [d.message || "Nouvelle notification"],
  },
  welcome: {
    template: "welcome_smartberry",
    params: (d) => [d.displayName || d.name || "utilisateur"],
  },
  expedition_rejected: {
    template: "expedition_rejected",
    params: (d) => [
      d.receiptId || "—",
      d.dateTime || "—",
      d.variety || "—",
      d.ranch || "—",
      d.weightKg || "0",
      d.reason || "Non précisé",
    ],
  },
  bdc_reminder: {
    template: "bdc_reminder",
    params: (d) => [d.numero || "—", d.montant || "—", d.duration || "quelques jours"],
  },
  bdc_avis_virement: {
    template: "bdc_avis_virement",
    params: (d) => [d.numero || "—", d.supplier || "Fournisseur"],
  },
  expedition_rejected_doc: {
    template: "expedition_rejected_doc",
    supportsDocument: true,
    params: (d) => [
      d.receiptId || "—",
      d.dateTime || "—",
      d.variety || "—",
      d.ranch || "—",
      d.weightKg || "0",
      d.reason || "Non précisé",
    ],
  },
};

/**
 * @typedef {object} WhatsAppDispatchResult
 * @property {number} sent       - Destinataires WhatsApp RÉELLEMENT atteints (humains).
 * @property {number} failed     - Envois tentés puis échoués.
 * @property {number} recipients - Destinataires résolus (après dédoublonnage téléphone).
 */

/**
 * @typedef {object} DispatchResult
 * @property {WhatsAppDispatchResult} whatsapp - Compte DÉCISIONNEL : seul indicateur
 *   fiable qu'un humain a été prévenu.
 * @property {{attempted:boolean, created:boolean}} in_app - INFORMATIF uniquement.
 */

/**
 * Dispatch a notification to one or more profiles.
 *
 * ⚠️ Sémantique du retour — à lire avant de brancher une décision dessus :
 * un appelant qui doit savoir « est-ce que quelqu'un a été prévenu ? » DOIT
 * regarder `result.whatsapp.sent`, et RIEN d'autre. Le bloc `in_app` est
 * purement informatif : une alerte in-app est écrite dans la collection
 * `alerts` même avec `profiles: []`, donc son succès d'écriture ne prouve
 * l'atteinte d'AUCUN humain. Agréger les deux compteurs ferait passer pour
 * « notifié » un dispatch qui n'a touché personne.
 *
 * @param {object} opts
 * @param {string} opts.type - Notification type (key in TEMPLATE_MAP)
 * @param {string[]} opts.profiles - Profile IDs to notify (e.g. ["chef", "dg"])
 * @param {string} [opts.ferme] - Farm filter (for chef profiles)
 * @param {object} opts.data - Data for template params and alert message
 * @param {string} [opts.data.message] - Human-readable message for in-app alert
 * @param {string[]} [opts.channels] - Channels to use (default: ["in_app", "whatsapp"])
 * @param {string} [opts.relatedDoc] - Related Firestore document path for logging
 * @returns {Promise<DispatchResult>}
 */
async function dispatchNotification({ type, profiles, ferme, data, channels, relatedDoc, document }) {
  const activeChannels = channels || ["in_app", "whatsapp"];

  const willSendWhatsApp = activeChannels.includes("whatsapp") && !!TEMPLATE_MAP[type];

  // In-app alert (marked so onAlertCreated trigger doesn't re-send WhatsApp)
  const inAppPromise = activeChannels.includes("in_app") && data.message
    ? createInAppAlert(type, profiles, data.message, data.severity, willSendWhatsApp)
    : null;

  // WhatsApp
  const whatsappPromise = willSendWhatsApp
    ? sendWhatsAppToProfiles(profiles, ferme, TEMPLATE_MAP[type], data, relatedDoc, type, document)
    : null;

  // Execute all channels in parallel, catch errors silently
  const [inAppOutcome, whatsappOutcome] = await Promise.allSettled([inAppPromise, whatsappPromise]);

  const whatsappResult = whatsappOutcome.status === "fulfilled" && whatsappOutcome.value
    ? whatsappOutcome.value
    : { sent: 0, failed: 0, recipients: 0 };

  return {
    whatsapp: whatsappResult,
    in_app: {
      attempted: !!inAppPromise,
      created: inAppOutcome.status === "fulfilled" && inAppOutcome.value === true,
    },
  };
}

/**
 * Build a concise WhatsApp-ready summary for a BDC (≤1024 chars to fit document caption).
 * Falls back gracefully if some fields are missing.
 */
function buildBdcWhatsAppSummary(bdc) {
  if (!bdc) return "";
  const numero = bdc.numero || bdc.id || "—";
  const supplier = (bdc.fournisseur && bdc.fournisseur.nom) || bdc.supplier_name || "Fournisseur ?";
  const ferme = bdc.ferme || "—";
  const totalTtc = bdc.total_ttc != null
    ? `${Number(bdc.total_ttc).toLocaleString("fr-FR")} MAD TTC`
    : "—";
  const items = Array.isArray(bdc.items) ? bdc.items : [];
  const top = items.slice(0, 3).map((it) => {
    const lib = it.article || it.designation || "Article";
    const qte = it.quantite || "?";
    const unit = it.unite || "";
    return `• ${String(lib).slice(0, 50)} ×${qte}${unit ? " " + unit : ""}`;
  });
  const more = items.length > 3 ? `\n… et ${items.length - 3} autre(s) article(s)` : "";
  const paiementLabel = {
    virement_bancaire: "Virement bancaire",
    comptant_virement: "Comptant (virement)",
    comptant_cheque: "Comptant (chèque)",
    comptant_especes: "Comptant (espèces)",
  };
  const paiement = paiementLabel[bdc.mode_paiement] || bdc.mode_paiement || "—";

  return [
    `📋 BDC #${numero}`,
    `🏭 ${supplier} — Ferme ${ferme}`,
    `💰 ${totalTtc}`,
    "",
    `Articles (${items.length}):`,
    ...top,
    more,
    "",
    `Mode paiement : ${paiement}`,
    "",
    `Répondez *OK* pour valider ou *NON* pour rejeter,`,
    `ou utilisez les boutons ci-dessous.`,
  ].filter(Boolean).join("\n").slice(0, 1024);
}

/**
 * Create an in-app alert in the `alerts` collection.
 * Marks the alert with `whatsapp_dispatched: true` if the dispatcher is also
 * sending WhatsApp itself, so the onAlertCreated trigger doesn't re-send.
 *
 * ⚠️ Le booléen retourné dit seulement que l'écriture Firestore a réussi — PAS
 * qu'un humain a été notifié (l'alerte est écrite même avec `profiles: []`).
 * Ne jamais s'en servir pour décider qu'une notification est partie.
 *
 * @returns {Promise<boolean>} true si le document `alerts` a été écrit.
 */
async function createInAppAlert(type, profiles, message, severity, whatsappDispatched) {
  try {
    await db.collection("alerts").add({
      type,
      message,
      profiles,
      severity: severity || "info",
      createdAt: Date.now(),
      read: {},
      whatsapp_dispatched: !!whatsappDispatched,
    });
    return true;
  } catch (err) {
    console.error("Failed to create in-app alert:", err.message);
    return false;
  }
}

/**
 * Send WhatsApp template messages to all users matching the given profiles.
 *
 * @returns {Promise<WhatsAppDispatchResult>} Toujours un objet, jamais undefined :
 *   `sent` compte les destinataires humains réellement atteints.
 *
 * ⚠️ Piège sémantique sur `sent`, type par type : pour `bdc_virement_launched`,
 * le DG est volontairement EXCLU de `templateRecipients` (il reçoit un message
 * interactif à la place du template générique). `sent` peut donc valoir 0 avec
 * `recipients: 1` alors que le DG a bien été touché. Ne pas conclure à un échec
 * d'envoi sur ce type. Les autres types (dont `bdc_reminder`) n'empruntent pas
 * ce chemin : `sent` y reflète bien les humains atteints.
 */
async function sendWhatsAppToProfiles(profiles, ferme, mapping, data, relatedDoc, type, document) {
  try {
    // Resolve all recipients across all target profiles
    const recipientSets = await Promise.all(
      profiles.map(p => whatsapp.resolveRecipientsForProfile(p, ferme))
    );
    const allRecipients = recipientSets.flat();

    // Deduplicate by phone number
    const seen = new Set();
    const unique = allRecipients.filter(r => {
      if (seen.has(r.phone)) return false;
      seen.add(r.phone);
      return true;
    });

    // Sortie 1/3 : aucun destinataire résolu → personne n'a été prévenu.
    if (unique.length === 0) return { sent: 0, failed: 0, recipients: 0 };

    const bodyParams = mapping.params(data);
    const useDocument = !!(mapping.supportsDocument && document && (document.mediaId || document.link));

    // On virement launched, the DG gets a separate enriched interactive
    // message below (fournisseur/montant/PJ) — skip the generic template for them.
    const templateRecipients = type === "bdc_virement_launched"
      ? unique.filter(r => r.profileId !== "dg")
      : unique;

    // Send to all recipients in parallel
    const results = await Promise.allSettled(
      templateRecipients.map(async (recipient) => {
        const result = useDocument
          ? await whatsapp.sendTemplateMessageWithDocument(
              recipient.phone,
              mapping.template,
              document.mediaId ? { mediaId: document.mediaId } : { link: document.link },
              document.filename,
              bodyParams,
              undefined,
              recipient.displayName
            )
          : await whatsapp.sendTemplateMessage(
              recipient.phone,
              mapping.template,
              bodyParams,
              undefined,
              recipient.displayName
            );
        // Update log with related doc reference
        if (relatedDoc && result.success) {
          try {
            const logSnap = await db.collection("whatsapp_logs")
              .where("waMessageId", "==", result.waMessageId)
              .limit(1).get();
            if (!logSnap.empty) {
              await logSnap.docs[0].ref.update({ relatedDoc, profile: recipient.profileId });
            }
          } catch (_) {}
        }
        return result;
      })
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value?.success).length;
    const failed = results.length - sent;
    if (failed > 0) {
      console.warn(`WhatsApp dispatch [${mapping.template}]: ${sent} sent, ${failed} failed`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // BDC submission: persist an approval session so chefBdcBot can route the
    // chef/DG reply. The decision is taken by replying *OK* / *NON* to the
    // template, whose body now carries that instruction.
    //
    // We deliberately do NOT send free-form interactive buttons or a separate
    // PDF document here: those are "session" messages that Meta rejects outside
    // the 24h customer-service window — and a business-initiated template does
    // NOT open that window (only an inbound message from the chef does). That
    // is exactly why buttons used to appear only after the chef first wrote to
    // the bot. The PDF, when present, is attached to the bdc_submit_doc
    // template itself, so it still reaches the recipient.
    // ─────────────────────────────────────────────────────────────────────
    if ((type === "bdc_submit" || type === "bdc_submit_doc") && data.bdc_id) {
      const chefBdcBot = require("../magasin/chefBdcBot");
      await Promise.allSettled(unique.map(async (recipient) => {
        try {
          // Determine the role for validation based on which profile this recipient matches
          // (priority: chef > dg > skip)
          const role = typeof recipient.profileId === "string" && recipient.profileId.indexOf("chef_") === 0 ? "chef"
                     : recipient.profileId === "dg" ? "dg"
                     : null;
          if (!role) return; // we only set up session for chef/dg

          await chefBdcBot.startBdcApprovalSession(recipient.phone, {
            bdc_id: data.bdc_id,
            role,
            ferme: role === "chef" ? (recipient.ferme || ferme) : null,
          });
        } catch (err) {
          console.error(`BDC approval session setup failed for ${recipient.phone}:`, err.message);
        }
      }));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Chef-approved BDC: DG gets an approval session (OK/NON reply) to
    // validate directly from WhatsApp, mirroring the chef's own flow.
    // Achats stays informational only.
    // ─────────────────────────────────────────────────────────────────────
    if ((type === "bdc_chef_approved" || type === "bdc_chef_approved_doc") && data.bdc_id) {
      const chefBdcBot = require("../magasin/chefBdcBot");
      await Promise.allSettled(unique.map(async (recipient) => {
        if (recipient.profileId !== "dg") return;
        try {
          await chefBdcBot.startBdcApprovalSession(recipient.phone, {
            bdc_id: data.bdc_id, role: "dg", ferme: null,
          });
        } catch (err) {
          console.error(`BDC approval session (DG) setup failed for ${recipient.phone}:`, err.message);
        }
      }));
    }

    // ─────────────────────────────────────────────────────────────────────
    // DG-approved BDC (virement mode): Finance also receives an action button
    // to confirm the virement has been entered ("saisi"). Other profiles
    // (achats) only get the informational template.
    // ─────────────────────────────────────────────────────────────────────
    if (type === "bdc_dg_approved" && data.bdc_id) {
      const chefBdcBot = require("../magasin/chefBdcBot");
      await Promise.allSettled(unique.map(async (recipient) => {
        if (recipient.profileId !== "finance") return;
        try {
          await whatsapp.sendInteractiveButtons(
            recipient.phone,
            `BDC #${data.numero || data.bdc_id} validé par DG. Confirmez la saisie du virement quand c'est fait :`,
            [{ id: chefBdcBot.BTN.VIREMENT_SAISI, title: "💸 Virement saisi" }]
          );
          await chefBdcBot.startVirementLanceSession(recipient.phone, { bdc_id: data.bdc_id });
        } catch (err) {
          console.error(`Virement-lance setup failed for ${recipient.phone}:`, err.message);
        }
      }));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Virement launched: DG gets an action button to confirm signature.
    // ─────────────────────────────────────────────────────────────────────
    if (type === "bdc_virement_launched" && data.bdc_id) {
      const chefBdcBot = require("../magasin/chefBdcBot");
      await Promise.allSettled(unique.map(async (recipient) => {
        if (recipient.profileId !== "dg") return;
        try {
          const interactiveResult = await whatsapp.sendInteractiveButtons(
            recipient.phone,
            `BDC #${data.numero || data.bdc_id} — ${data.fournisseur || "Fournisseur"} — ${data.montant || "Montant non précisé"} — virement à signer. Confirmez après signature :`,
            [{ id: chefBdcBot.BTN.VIREMENT_SIGNED, title: "✍️ Virement signé" }],
            document ? { type: "document", link: document.link, filename: document.filename } : undefined
          );
          if (interactiveResult.success) {
            await chefBdcBot.startVirementSigneSession(recipient.phone, { bdc_id: data.bdc_id });
          } else {
            // Message interactif hors fenêtre de session 24h Meta (échec silencieux) :
            // filet de sécurité pour que le DG reçoive au moins le template générique.
            console.warn(`Virement-signe interactive failed for ${recipient.phone} (${interactiveResult.error}) — fallback template`);
            await whatsapp.sendTemplateMessage(recipient.phone, mapping.template, bodyParams, undefined, recipient.displayName);
          }
        } catch (err) {
          console.error(`Virement-signe setup failed for ${recipient.phone}:`, err.message);
        }
      }));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Virement signed: remind Finance to upload the "avis de virement" PDF.
    // ─────────────────────────────────────────────────────────────────────
    if (type === "bdc_virement_signed" && data.bdc_id) {
      await Promise.allSettled(unique.map(async (recipient) => {
        if (recipient.profileId !== "finance") return;
        try {
          await whatsapp.sendTemplateMessage(
            recipient.phone,
            "general_alert",
            [whatsapp.toSingleLine(`📎 Pensez à joindre l'avis de virement signé sur Smart Berry pour le BDC #${data.numero || data.bdc_id}.`)]
          );
        } catch (err) {
          console.error(`Finance avis reminder failed for ${recipient.phone}:`, err.message);
        }
      }));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Avis de virement: send PDF document right after the template
    // (informational — no buttons, no session).
    // ─────────────────────────────────────────────────────────────────────
    if (type === "bdc_avis_virement" && data.bdc_id && data.pdf_url) {
      const filename = `AvisVirement_${data.numero || data.bdc_id}.pdf`;
      const caption = `📎 Avis de virement — BDC #${data.numero || data.bdc_id}\n🏭 ${data.supplier || "Fournisseur"}`;
      await Promise.allSettled(unique.map(async (recipient) => {
        try {
          await whatsapp.sendDocumentMessage(recipient.phone, data.pdf_url, filename, caption);
        } catch (err) {
          console.error(`Avis virement document send failed for ${recipient.phone}:`, err.message);
        }
      }));
    }

    // Sortie 2/3 : chemin nominal.
    return { sent, failed, recipients: unique.length };
  } catch (err) {
    console.error("WhatsApp dispatch error:", err.message);
    // Sortie 3/3 : erreur globale → on ne peut garantir aucun envoi.
    return { sent: 0, failed: 0, recipients: 0 };
  }
}

module.exports = { dispatchNotification, TEMPLATE_MAP, buildBdcWhatsAppSummary };
