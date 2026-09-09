/* Actions 1/6 de stockManagement — corps repris VERBATIM.
   Le contexte du handler (req, res, action, helpers) arrive par `ctx` ; la
   destructuration ci-dessous recree exactement les liaisons d'origine, si bien
   que les corps n'ont pas ete touches. */
'use strict';
const { NOT_HANDLED } = require("./_dispatch");
const { admin, db_firestore, demandeCreationArticle, dispatchNotification, functions, withCache, nodemailer, validateBdcCore, remindBdcCore, updateBdcVirementCore, recordVirementAvis, bdcWorkflow, bdcReceptionGuard, validateSupplier, stockMovementGuard, receptionBdc, identiteArticle, getIdentiteArticleIndex, enregistrerDemandesCreation, getNextNumber } = require("./magasin.stock.deps");

module.exports = async function stockActions1(ctx) {
  const { req, res, action, adminSecret, authUser, updateStockBalance, applyStockImpact, reverseStockImpact, getChefProfileForFerme, resolveRequesterIdentity } = ctx;


      // ========== SUPPLIERS ==========

      if (action === "list-suppliers") {
        const status = req.query.status; // "valide", "en_attente", "rejete", or empty for all active
        let snap;
        if (status) {
          snap = await db_firestore.collection("suppliers")
            .where("active", "==", true)
            .where("status", "==", status)
            .get();
        } else {
          snap = await db_firestore.collection("suppliers")
            .where("active", "==", true)
            .get();
        }
        const suppliers = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        suppliers.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr", { sensitivity: "base" }));
        return res.json({ success: true, suppliers });
      }


      if (action === "create-supplier" && req.method === "POST") {
        const { nom, ice, identifiant_fiscal, adresse, ville, tel, email, contact_nom, categorie, created_by } = req.body;
        const validation = validateSupplier({ nom, adresse, identifiant_fiscal, ice, contact_nom, tel });
        if (!validation.valid) {
          return res.status(400).json({ success: false, error: "Champs invalides", errors: validation.errors });
        }
        const now = Date.now();
        const docRef = await db_firestore.collection("suppliers").add({
          nom, ice: ice || "", identifiant_fiscal: identifiant_fiscal || "",
          adresse: adresse || "", ville: ville || "",
          tel: tel || "", email: email || "", contact_nom: contact_nom || "",
          categorie: categorie || "autre",
          status: "valide", // Validation automatique à la création
          validated_at: now, validated_by: created_by || {},
          active: true, created_by: created_by || {},
          history: [
            { action: "creation", by: created_by || {}, at: now, comment: "Fournisseur créé" },
            { action: "validation_auto", by: created_by || {}, at: now, comment: "Validation automatique (champs conformes)" },
          ],
          created_at: now, updated_at: now,
        });
        return res.json({ success: true, id: docRef.id });
      }


      if (action === "update-supplier" && req.method === "POST") {
        const { id, updated_by, ...updates } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("suppliers").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Fournisseur non trouvé" });
        const current = doc.data();
        // Valider l'état résultant (merge current + updates)
        const merged = { ...current, ...updates };
        const validation = validateSupplier({
          nom: merged.nom, adresse: merged.adresse, identifiant_fiscal: merged.identifiant_fiscal,
          ice: merged.ice, contact_nom: merged.contact_nom, tel: merged.tel,
        });
        if (!validation.valid) {
          return res.status(400).json({ success: false, error: "Champs invalides", errors: validation.errors });
        }
        const now = Date.now();
        await db_firestore.collection("suppliers").doc(id).update({
          ...updates, status: "valide", updated_at: now,
          history: [...(current.history || []), { action: "modification", by: updated_by || {}, at: now, comment: "Fournisseur modifié" }],
        });
        return res.json({ success: true });
      }


      // ========== PURCHASE ORDERS (BDC) ==========

      if (action === "list-bdc") {
        const ferme = req.query.ferme;
        const status = req.query.status;
        const statuses = status ? String(status).split(",").map((s) => s.trim()).filter(Boolean) : [];
        const limit = parseInt(req.query.limit || "200");
        let query = db_firestore.collection("purchase_orders");
        const hasFilter = ferme || statuses.length > 0;
        if (ferme) query = query.where("ferme", "==", ferme);
        if (statuses.length === 1) query = query.where("status", "==", statuses[0]);
        else if (statuses.length > 1) query = query.where("status", "in", statuses);
        if (!hasFilter) query = query.orderBy("created_at", "desc");
        query = query.limit(limit);
        const snap = await query.get();
        let bdc = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        if (hasFilter) bdc.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return res.json({ success: true, bdc });
      }


      if (action === "get-bdc") {
        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        // Fetch linked delivery notes (no orderBy to avoid composite index requirement)
        const blSnap = await db_firestore.collection("delivery_notes").where("bdc_id", "==", id).get();
        const bls = blSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at || '') > (a.created_at || '') ? -1 : 1);
        // Fetch linked invoices
        const facSnap = await db_firestore.collection("invoices").where("bdc_id", "==", id).get();
        const factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at || '') > (a.created_at || '') ? -1 : 1);
        return res.json({ success: true, bdc: { id: doc.id, ...doc.data() }, bls, factures });
      }


      if (action === "create-bdc" && req.method === "POST") {
        const { supplier_id, fournisseur, ferme, date_livraison_prevue, items, created_by,
          purchase_request_id, consultation_id, code_analytique, mode_paiement } = req.body;
        if (!fournisseur?.nom || !ferme || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: fournisseur.nom, ferme, items[]" });
        }
        const numero = await getNextNumber("purchase_order", "BDC");
        // Compute totals
        let total_ht = 0, total_tva = 0, total_ttc = 0;
        const computedItems = items.map((item) => {
          const montant_ht = (parseFloat(item.quantite) || 0) * (parseFloat(item.prix_unitaire) || 0);
          const taux = item.taux_tva != null && item.taux_tva !== '' ? parseFloat(item.taux_tva) : 20;
          const montant_tva = montant_ht * taux / 100;
          const montant_ttc = montant_ht + montant_tva;
          total_ht += montant_ht;
          total_tva += montant_tva;
          total_ttc += montant_ttc;
          return { ...item, montant_ht: Math.round(montant_ht * 100) / 100, montant_tva: Math.round(montant_tva * 100) / 100, montant_ttc: Math.round(montant_ttc * 100) / 100, taux_tva: taux };
        });
        const bdcData = {
          numero, status: "brouillon",
          purchase_request_id: purchase_request_id || null,
          consultation_id: consultation_id || null,
          supplier_id: supplier_id || null,
          fournisseur, ferme,
          date_livraison_prevue: date_livraison_prevue || "",
          code_analytique: code_analytique || "",
          mode_paiement: mode_paiement || "virement_bancaire",
          items: computedItems,
          total_ht: Math.round(total_ht * 100) / 100,
          total_tva: Math.round(total_tva * 100) / 100,
          total_ttc: Math.round(total_ttc * 100) / 100,
          delivery_status: "non_livre",
          invoice_status: "non_facture",
          created_by: created_by || {},
          validated_by_chef: null,
          validated_by_dg: null,
          history: [{ action: "creation", by: created_by || {}, at: Date.now(), comment: "" }],
          created_at: Date.now(), updated_at: Date.now(),
        };
        const docRef = await db_firestore.collection("purchase_orders").add(bdcData);
        return res.json({ success: true, id: docRef.id, numero });
      }


      if (action === "update-bdc" && req.method === "POST") {
        const { id, items, fournisseur, supplier_id, ferme, date_livraison_prevue, updated_by,
          code_analytique, mode_paiement } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        if (current.status !== "brouillon" && current.status !== "rejete") {
          return res.status(400).json({ success: false, error: "Le BDC ne peut être modifié que s'il est en brouillon ou rejeté" });
        }
        const updates = { updated_at: Date.now() };
        if (fournisseur) updates.fournisseur = fournisseur;
        if (supplier_id) updates.supplier_id = supplier_id;
        if (ferme) updates.ferme = ferme;
        if (date_livraison_prevue) updates.date_livraison_prevue = date_livraison_prevue;
        if (code_analytique !== undefined) updates.code_analytique = code_analytique;
        if (mode_paiement) updates.mode_paiement = mode_paiement;
        if (items?.length) {
          let total_ht = 0, total_tva = 0, total_ttc = 0;
          updates.items = items.map((item) => {
            const montant_ht = (parseFloat(item.quantite) || 0) * (parseFloat(item.prix_unitaire) || 0);
            const taux = item.taux_tva != null && item.taux_tva !== '' ? parseFloat(item.taux_tva) : 20;
            const montant_tva = montant_ht * taux / 100;
            const montant_ttc = montant_ht + montant_tva;
            total_ht += montant_ht;
            total_tva += montant_tva;
            total_ttc += montant_ttc;
            return { ...item, montant_ht: Math.round(montant_ht * 100) / 100, montant_tva: Math.round(montant_tva * 100) / 100, montant_ttc: Math.round(montant_ttc * 100) / 100, taux_tva: taux };
          });
          updates.total_ht = Math.round(total_ht * 100) / 100;
          updates.total_tva = Math.round(total_tva * 100) / 100;
          updates.total_ttc = Math.round(total_ttc * 100) / 100;
        }
        const history = current.history || [];
        history.push({ action: "modification", by: updated_by || {}, at: Date.now(), comment: "" });
        updates.history = history;
        await db_firestore.collection("purchase_orders").doc(id).update(updates);
        return res.json({ success: true });
      }


      if (action === "submit-bdc" && req.method === "POST") {
        const { id, submitted_by, pdf_url } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        if (current.status !== "brouillon" && current.status !== "rejete") {
          return res.status(400).json({ success: false, error: "Seul un BDC en brouillon ou rejeté peut être soumis" });
        }
        const history = current.history || [];
        const now = Date.now();
        // Fermes sans chef de ferme (Avocatier, F2, F3, F4, F6, BAHIA) → soumission directe au DG.
        // Source de vérité : functions/lib/bdc/workflow.js (mirror public/lib/bdcWorkflow.js).
        const skipChef = !bdcWorkflow.requiresChefValidation(current.ferme);
        const nextStatus = bdcWorkflow.nextStatusOnSubmit(current.ferme);
        const historyEntry = {
          action: skipChef ? "soumission_directe_dg" : "soumission",
          by: submitted_by || {},
          at: now,
          comment: skipChef ? `Ferme ${current.ferme} sans Chef de Ferme — soumission directe au DG` : "",
        };
        const bypassReason = bdcWorkflow.bypassReason(current.ferme);
        if (bypassReason) historyEntry.bypass_reason = bypassReason;
        history.push(historyEntry);
        const updatePatch = { status: nextStatus, history, updated_at: now };
        if (pdf_url) updatePatch.pdf_url = pdf_url;
        await db_firestore.collection("purchase_orders").doc(id).update(updatePatch);
        // WhatsApp: notify chef de ferme OU DG selon le cas
        const { buildBdcWhatsAppSummary } = require("../../../notificationDispatcher");
        const bdcForSummary = { ...current, id };
        const bdcPdfUrl = pdf_url || current.pdf_url || null;
        const useDocTemplate = !!bdcPdfUrl;
        // Résumé articles sur une ligne (params Meta : pas de saut de ligne ni 4+ espaces).
        const _items = Array.isArray(current.items) ? current.items : [];
        const _clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
        const _itemLabel = (it) => {
          const lib = _clean(it.article || it.designation || "Article");
          const qte = it.quantite != null && it.quantite !== "" ? it.quantite : "?";
          const unite = it.unite ? ` ${_clean(it.unite)}` : "";
          return `${lib} ×${qte}${unite}`;
        };
        const articlesSummary = _items.length
          ? _items.slice(0, 3).map(_itemLabel).join(", ") + (_items.length > 3 ? ` (+${_items.length - 3} autres)` : "")
          : "—";
        const fournisseurNom = _clean((current.fournisseur && current.fournisseur.nom) || "") || "—";
        const dispatchPromise = dispatchNotification({
          type: useDocTemplate ? "bdc_submit_doc" : "bdc_submit",
          profiles: skipChef ? ["dg"] : [bdcWorkflow.chefProfileForFerme(current.ferme)].filter(Boolean),
          ferme: skipChef ? null : current.ferme,
          data: {
            numero: current.numero || id,
            fournisseur: fournisseurNom,
            articles: articlesSummary,
            montant: current.total_ttc ? `${current.total_ttc} MAD` : "Non précisé",
            message: `BDC ${current.numero || id} en attente de validation ${skipChef ? "DG" : "Chef"}`,
            bdc_id: id,
            pdf_url: bdcPdfUrl,
            summary: buildBdcWhatsAppSummary(bdcForSummary),
          },
          relatedDoc: `purchase_orders/${id}`,
          ...(useDocTemplate ? { document: { link: bdcPdfUrl, filename: `BDC_${current.numero || id}.pdf` } } : {}),
        })
          // dispatchNotification renvoie déjà { sent, failed, recipients } — on le
          // jetait. Un DG sans numéro, un template non approuvé ou un token expiré
          // étaient donc indiscernables d'un envoi réussi : l'écran disait
          // « soumis » et personne n'était prévenu. Le résultat est ATTENDU et
          // renvoyé au client, qui l'affiche. Le statut du BDC est déjà écrit à ce
          // stade : un échec WhatsApp ne remet pas la soumission en cause, il la
          // documente.
          .then(r => { const w = (r && r.whatsapp) || {}; return { sent: w.sent || 0, failed: w.failed || 0, recipients: w.recipients || 0 }; })
          .catch(err => { console.error("WhatsApp dispatch error:", err); return { sent: 0, failed: 1, recipients: 0, error: String(err && err.message || err) }; });
        const notification = await dispatchPromise;
        return res.json({ success: true, notification });
      }


      // One-shot migration: redirige les BdC actuellement en `en_attente_chef` pour
      // des fermes DIRECT_DG_FARMS (Avocatier/F2/F3/F4/F6/BAHIA) vers `en_attente_dg`.
      // Protégé par admin-secret. À lancer une fois après déploiement de la nouvelle règle.
      if (action === "migrate-bdc-direct-dg" && req.method === "POST") {
        if (req.body.secret !== adminSecret) return res.status(403).json({ success: false, error: "forbidden" });
        const snap = await db_firestore.collection("purchase_orders")
          .where("status", "==", "en_attente_chef").get();
        const targets = snap.docs.filter(d => !bdcWorkflow.requiresChefValidation(d.data().ferme));
        const now = Date.now();
        const migratedIds = [];
        const unknownFermes = new Set();
        // Firestore batch limit = 500 ; on chunke à 400 par convention CLAUDE.md.
        for (let i = 0; i < targets.length; i += 400) {
          const batch = db_firestore.batch();
          const chunk = targets.slice(i, i + 400);
          for (const d of chunk) {
            const data = d.data();
            const history = (data.history || []).concat([{
              action: "migration_direct_dg",
              by: { profileId: "system", name: "Migration script" },
              at: now,
              comment: `BDC redirigé vers DG (règle DIRECT_DG_FARMS, ferme=${data.ferme})`,
              bypass_reason: "no_chef_de_ferme",
              previous_status: "en_attente_chef",
            }]);
            batch.update(d.ref, { status: "en_attente_dg", history, updated_at: now });
            migratedIds.push(d.id);
          }
          await batch.commit();
        }
        // Data-quality signal : log les fermes inconnues croisées (ni F1/F5 ni 6 fermes ciblées).
        for (const d of snap.docs) {
          const f = d.data().ferme;
          if (!f || (bdcWorkflow.requiresChefValidation(f) && !["F1", "F5"].includes(f))) unknownFermes.add(f || "(empty)");
        }
        return res.json({
          success: true,
          scanned: snap.size,
          migrated: targets.length,
          migrated_ids: migratedIds,
          unknown_fermes: Array.from(unknownFermes),
        });
      }


      if (action === "delete-bdc" && req.method === "POST") {
        const { id, deleted_by } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const requesterProfile = deleted_by && deleted_by.profileId;
        const canForceDelete = requesterProfile === "achats" || requesterProfile === "admin";
        if (doc.data().status !== "brouillon" && !canForceDelete) {
          return res.status(400).json({ success: false, error: "Seul un BDC en brouillon peut être supprimé" });
        }
        await db_firestore.collection("purchase_orders").doc(id).delete();
        return res.json({ success: true });
      }


      if (action === "validate-bdc" && req.method === "POST") {
        const { id, decision, role, profileId, name, comment, ferme: validatorFerme } = req.body;
        const result = await validateBdcCore({
          id, decision, role, profileId, name, comment, ferme: validatorFerme, via: "dashboard",
        });
        if (!result.success) {
          return res.status(result.statusCode || 400).json({ success: false, error: result.error });
        }
        return res.json({ success: true });
      }


      if (action === "send-bdc" && req.method === "POST") {
        const { id, sent_by } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        const isVirement = current.mode_paiement === "comptant_virement" || current.mode_paiement === "virement_bancaire";
        if (isVirement) {
          if (current.status !== "virement_signe") {
            return res.status(400).json({ success: false, error: "Le virement doit être signé avant l'envoi au fournisseur" });
          }
        } else {
          if (current.status !== "valide_dg") {
            return res.status(400).json({ success: false, error: "Le BDC doit être validé par le DG avant envoi" });
          }
        }
        const history = current.history || [];
        history.push({ action: "envoi_fournisseur", by: sent_by || {}, at: Date.now(), comment: "" });
        await db_firestore.collection("purchase_orders").doc(id).update({
          status: "envoye", history, updated_at: Date.now(),
        });
        // WhatsApp: notify finance
        dispatchNotification({
          type: "bdc_sent_to_supplier", profiles: ["finance"],
          data: {
            numero: current.numero || id,
            supplier: current.supplier_name || "Fournisseur inconnu",
            message: `BDC ${current.numero || id} envoyé au fournisseur`,
          },
          relatedDoc: `purchase_orders/${id}`,
        }).catch(err => console.error("WhatsApp dispatch error:", err));
        return res.json({ success: true });
      }


      if (action === "update-bdc-virement" && req.method === "POST") {
        const { id, decision, by } = req.body;
        const result = await updateBdcVirementCore({ id, decision, by, via: "dashboard" });
        if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
        return res.json({ success: true });
      }


      if (action === "upload-virement-avis" && req.method === "POST") {
        const { id, avis_pdf_url, uploaded_by } = req.body;
        const result = await recordVirementAvis({ id, avis_pdf_url, uploaded_by });
        if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
        return res.json({ success: true });
      }


      if (action === "migrate-bdc-mode-paiement" && req.method === "POST") {
        // One-shot migration: virement_bancaire → comptant_virement, caisse → comptant_especes, comptant → facilite
        const snap = await db_firestore.collection("purchase_orders").get();
        const map = { virement_bancaire: "comptant_virement", caisse: "comptant_especes", comptant: "facilite" };
        let updated = 0;
        const batch = db_firestore.batch();
        snap.forEach(doc => {
          const m = doc.data().mode_paiement;
          if (m && map[m]) {
            batch.update(doc.ref, { mode_paiement: map[m] });
            updated++;
          }
        });
        if (updated > 0) await batch.commit();
        return res.json({ success: true, updated, total: snap.size });
      }


      if (action === "remind-bdc" && req.method === "POST") {
        const { id, by } = req.body;
        const result = await remindBdcCore({ id, by, via: "dashboard" });
        if (!result.success) {
          return res.status(result.statusCode || 400).json({ success: false, error: result.error });
        }
        return res.json({ success: true, profiles: result.profiles, duration: result.duration });
      }


      // ---- BDC Change Requests (modification/annulation) ----
      if (action === "request-bdc-change" && req.method === "POST") {
        const { bdc_id, type, motif, requested_by } = req.body;
        if (!bdc_id || !type || !motif) return res.status(400).json({ success: false, error: "bdc_id, type et motif requis" });
        if (!["modification", "annulation"].includes(type)) return res.status(400).json({ success: false, error: "type doit être modification ou annulation" });
        const doc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = doc.data();
        if (!["valide_dg", "envoye", "virement_lance", "virement_signe"].includes(bdc.status)) {
          return res.status(400).json({ success: false, error: "Le BDC doit être validé DG ou au-delà pour demander une modification/annulation" });
        }
        // Check no pending request exists
        const existing = await db_firestore.collection("bdc_change_requests").where("bdc_id", "==", bdc_id).where("status", "==", "en_attente").get();
        if (!existing.empty) return res.status(400).json({ success: false, error: "Une demande est déjà en cours pour ce BDC" });
        const now = Date.now();
        const ref = await db_firestore.collection("bdc_change_requests").add({
          bdc_id, bdc_numero: bdc.numero || "", type, motif, status: "en_attente",
          requested_by: requested_by || {}, created_at: now,
        });
        const history = bdc.history || [];
        history.push({ action: "demande_" + type, by: requested_by || {}, at: now, comment: motif });
        await db_firestore.collection("purchase_orders").doc(bdc_id).update({ history, updated_at: now, pending_change_request: ref.id });
        return res.json({ success: true, id: ref.id });
      }


      if (action === "list-bdc-change-requests") {
        const { status } = req.query;
        let q = db_firestore.collection("bdc_change_requests");
        if (status) q = q.where("status", "==", status);
        const snap = await q.get();
        const requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        requests.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return res.json({ success: true, requests });
      }


      if (action === "approve-bdc-change" && req.method === "POST") {
        const { id, decision, comment, approved_by } = req.body;
        if (!id || !decision) return res.status(400).json({ success: false, error: "id et decision requis" });
        const reqDoc = await db_firestore.collection("bdc_change_requests").doc(id).get();
        if (!reqDoc.exists) return res.status(404).json({ success: false, error: "Demande non trouvée" });
        const request = reqDoc.data();
        if (request.status !== "en_attente") return res.status(400).json({ success: false, error: "Cette demande n'est plus en attente" });
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(request.bdc_id).get();
        if (!bdcDoc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = bdcDoc.data();
        const history = bdc.history || [];
        const now = Date.now();
        if (decision === "approve") {
          if (request.type === "modification") {
            history.push({ action: "retour_brouillon_dg", by: approved_by || {}, at: now, comment: comment || "Modification approuvée par DG" });
            await db_firestore.collection("purchase_orders").doc(request.bdc_id).update({
              status: "brouillon", validated_by_dg: null, validated_by_chef: null, notified_finance: false,
              history, updated_at: now, pending_change_request: null,
            });
          } else {
            history.push({ action: "annulation_dg", by: approved_by || {}, at: now, comment: comment || "Annulation approuvée par DG" });
            await db_firestore.collection("purchase_orders").doc(request.bdc_id).update({
              status: "annule", history, updated_at: now, pending_change_request: null,
            });
          }
          await db_firestore.collection("bdc_change_requests").doc(id).update({ status: "approuve", approved_by: approved_by || {}, approved_at: now, comment: comment || "" });
        } else {
          history.push({ action: "demande_rejetee_dg", by: approved_by || {}, at: now, comment: comment || "Demande refusée" });
          await db_firestore.collection("purchase_orders").doc(request.bdc_id).update({ history, updated_at: now, pending_change_request: null });
          await db_firestore.collection("bdc_change_requests").doc(id).update({ status: "rejete", approved_by: approved_by || {}, approved_at: now, comment: comment || "" });
        }
        return res.json({ success: true });
      }


      if (action === "send-bdc-email" && req.method === "POST") {
        const { bdc_id, to, subject, message, pdf_base64, pdf_filename, sent_by } = req.body;
        if (!bdc_id || !to) return res.status(400).json({ success: false, error: "bdc_id et email destinataire requis" });

        // Load SMTP config from Firestore
        const configDoc = await db_firestore.collection("config").doc("email_smtp").get();
        const smtp = configDoc.exists ? configDoc.data() : {};
        if (!smtp.user || !smtp.pass) return res.status(400).json({ success: false, error: "Configuration SMTP non définie. Créez le document config/email_smtp dans Firestore avec les champs: host, port, user, pass" });

        const transporter = nodemailer.createTransport({
          host: smtp.host || "smtp.gmail.com",
          port: parseInt(smtp.port) || 587,
          secure: (smtp.port === "465" || smtp.port === 465),
          auth: { user: smtp.user, pass: smtp.pass },
        });

        const mailOptions = {
          from: smtp.from || smtp.user,
          to,
          subject: subject || "Bon de Commande - Berry Good Farms",
          text: message || "",
          attachments: pdf_base64 ? [{
            filename: pdf_filename || "BDC.pdf",
            content: Buffer.from(pdf_base64, "base64"),
            contentType: "application/pdf",
          }] : [],
        };

        await transporter.sendMail(mailOptions);

        // Update BDC status to envoye and log history
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (bdcDoc.exists) {
          const current = bdcDoc.data();
          const history = current.history || [];
          history.push({ action: "envoi_email", by: sent_by || {}, at: Date.now(), comment: "Envoyé par email à " + to });
          const updates = { history, updated_at: Date.now(), email_sent_to: to, email_sent_at: Date.now() };
          if (current.status === "valide_dg") updates.status = "envoye";
          await db_firestore.collection("purchase_orders").doc(bdc_id).update(updates);
        }

        return res.json({ success: true });
      }


      // ========== PENDING VALIDATIONS ==========

      if (action === "pending-validations") {
        const role = req.query.role;
        const ferme = req.query.ferme;
        const result = { bdc_chef: 0, bdc_dg: 0, factures_achats: 0, factures_finance: 0, factures_dg: 0 };

        if (role === "chef" && ferme) {
          const snap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_chef")
            .where("ferme", "==", ferme)
            .get();
          result.bdc_chef = snap.size;
        }
        if (role === "dg") {
          const bdcSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_dg").get();
          result.bdc_dg = bdcSnap.size;
          const facSnap = await db_firestore.collection("invoices")
            .where("payment_status", "==", "validee_finance").get();
          result.factures_dg = facSnap.size;
        }
        if (role === "finance") {
          const facSnap = await db_firestore.collection("invoices")
            .where("payment_status", "==", "validee_achats").get();
          result.factures_finance = facSnap.size;
        }
        if (role === "achats") {
          const facSnap = await db_firestore.collection("invoices")
            .where("payment_status", "==", "en_validation").get();
          result.factures_achats = facSnap.size;
          // DAs pending approval
          const daSnap = await db_firestore.collection("purchase_requests")
            .where("status", "==", "soumise").get();
          result.da_soumises = daSnap.size;
          result.da_list = daSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          // BDCs en brouillon (created from DA, need completion)
          const bdcBrouillonSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "brouillon").get();
          result.bdc_brouillon = bdcBrouillonSnap.size;
          // BDCs en attente validation chef
          const bdcChefSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_chef").get();
          result.bdc_attente_chef = bdcChefSnap.size;
          // BDCs en attente validation DG
          const bdcDgSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_dg").get();
          result.bdc_attente_dg = bdcDgSnap.size;
        }
        return res.json({ success: true, pending: result });
      }


      // ========== PURCHASE REQUESTS (DA) ==========

      if (action === "list-da") {
        const ferme = req.query.ferme;
        const status = req.query.status;
        const limit = parseInt(req.query.limit || "200");
        let query = db_firestore.collection("purchase_requests");
        const hasFilter = ferme || status;
        if (ferme) query = query.where("ferme", "==", ferme);
        if (status) query = query.where("status", "==", status);
        if (!hasFilter) query = query.orderBy("created_at", "desc");
        query = query.limit(limit);
        const snap = await query.get();
        let das = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        if (hasFilter) das.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return res.json({ success: true, das });
      }


      if (action === "create-da" && req.method === "POST") {
        const { ferme, urgence, justification, items, created_by } = req.body;
        if (!ferme || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: ferme, items[]" });
        }
        const numero = await getNextNumber("purchase_request", "DA");
        const daData = {
          numero, status: "soumise", ferme,
          urgence: urgence || "normale",
          justification: justification || "",
          items: items.map((it) => ({ article: it.article || "", categorie: it.categorie || "autre", quantite: parseFloat(it.quantite) || 0, unite: it.unite || "kg", note: it.note || "" })),
          created_by: created_by || {},
          history: [{ action: "creation", by: created_by || {}, at: Date.now(), comment: "" }],
          created_at: Date.now(), updated_at: Date.now(),
        };
        const docRef = await db_firestore.collection("purchase_requests").add(daData);
        return res.json({ success: true, id: docRef.id, numero });
      }


      if (action === "update-da" && req.method === "POST") {
        const { id, status, items, urgence, justification, updated_by, comment } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_requests").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "DA non trouvée" });
        const current = doc.data();
        const updates = { updated_at: Date.now() };
        if (status) updates.status = status;
        if (items) updates.items = items;
        if (urgence) updates.urgence = urgence;
        if (justification !== undefined) updates.justification = justification;
        const history = current.history || [];
        history.push({ action: status === "approuvee" ? "approbation" : status === "rejetee" ? "rejet" : "modification", by: updated_by || {}, at: Date.now(), comment: comment || "" });
        updates.history = history;
        await db_firestore.collection("purchase_requests").doc(id).update(updates);

        // Auto-create BDC when DA is approved
        if (status === "approuvee") {
          const daData = { ...current, ...updates };
          const bdcNumero = await getNextNumber("purchase_order", "BDC");
          // Load catalogue to auto-fill prices and TVA
          const catalogSnap = await db_firestore.collection("articles_catalog").where("active", "==", true).get();
          const catalogMap = {};
          catalogSnap.docs.forEach(d => { const data = d.data(); catalogMap[(data.nom || "").toLowerCase().trim()] = data; });
          const bdcItems = (daData.items || []).map((item) => {
            const catArticle = catalogMap[(item.article || "").toLowerCase().trim()] || {};
            const pu = catArticle.prix_ht || 0;
            const tva = catArticle.taux_tva != null && catArticle.taux_tva !== '' ? parseFloat(catArticle.taux_tva) : 20;
            const qty = parseFloat(item.quantite) || 1;
            const mht = pu * qty;
            return {
            article: item.article || "",
            categorie: item.categorie || catArticle.categorie || "autre",
            quantite: qty,
            unite: item.unite || catArticle.unite || "unité",
            prix_unitaire: pu,
            taux_tva: tva,
            montant_ht: Math.round(mht * 100) / 100,
            montant_tva: Math.round(mht * tva / 100 * 100) / 100,
            montant_ttc: Math.round(mht * (1 + tva / 100) * 100) / 100,
            note: item.note || "",
          };});
          const bdcData = {
            numero: bdcNumero,
            status: "brouillon",
            purchase_request_id: id,
            consultation_id: null,
            supplier_id: null,
            fournisseur: { nom: "À définir" },
            ferme: daData.ferme || "",
            date_livraison_prevue: "",
            code_analytique: "",
            mode_paiement: "virement_bancaire",
            items: bdcItems,
            total_ht: bdcItems.reduce((s, i) => s + (i.montant_ht || 0), 0),
            total_tva: bdcItems.reduce((s, i) => s + (i.montant_tva || 0), 0),
            total_ttc: bdcItems.reduce((s, i) => s + (i.montant_ttc || 0), 0),
            delivery_status: "non_livre",
            invoice_status: "non_facture",
            created_by: updated_by || {},
            validated_by_chef: null,
            validated_by_dg: null,
            history: [
              { action: "creation", by: updated_by || {}, at: Date.now(), comment: "Créé automatiquement depuis DA " + (daData.numero || id) },
            ],
            created_at: Date.now(), updated_at: Date.now(),
          };
          const bdcRef = await db_firestore.collection("purchase_orders").add(bdcData);
          // Link BDC back to DA
          await db_firestore.collection("purchase_requests").doc(id).update({
            bdc_id: bdcRef.id, bdc_numero: bdcNumero,
          });
          return res.json({ success: true, bdc_created: true, bdc_id: bdcRef.id, bdc_numero: bdcNumero });
        }

        return res.json({ success: true });
      }


      // ========== DELIVERY NOTES (BL) ==========

      if (action === "list-bl") {
        const bdc_id = req.query.bdc_id;
        const limit = parseInt(req.query.limit || "200");
        const hasFilter = !!bdc_id;
        let query = db_firestore.collection("delivery_notes");
        if (bdc_id) query = query.where("bdc_id", "==", bdc_id);
        if (!hasFilter) query = query.orderBy("created_at", "desc");
        query = query.limit(limit);
        const snap = await query.get();
        const bls = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((bl) => !bl.deleted);
        if (hasFilter) bls.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return res.json({ success: true, bls });
      }


      if (action === "create-bl" && req.method === "POST") {
        const { bdc_id, date_reception, numero_bl_fournisseur, items, created_by, scan_url, scan_id } = req.body;
        if (!bdc_id || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: bdc_id, items[]" });
        }
        // Fetch the BDC
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (!bdcDoc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = bdcDoc.data();
        if (!["valide_dg", "envoye", "virement_lance", "virement_signe"].includes(bdc.status)) {
          return res.status(400).json({ success: false, error: "Le BDC doit être validé ou envoyé pour recevoir un BL" });
        }
        if (bdc.delivery_status === "complet") {
          return res.status(400).json({ success: false, error: "Ce BDC est déjà entièrement réceptionné." });
        }

        // Reçu par article (BL existants) + commandé par article — calculés AVANT la création
        // du BL pour pouvoir valider le reliquat par article via functions/lib/bdc/receptionGuard.js.
        // Réutilisés plus bas pour la mise à jour finale de delivery_status (pas de duplication
        // du calcul ni de la requête Firestore).
        const existingBlSnap = await db_firestore.collection("delivery_notes").where("bdc_id", "==", bdc_id).get();
        const existingBls = existingBlSnap.docs.map((d) => d.data()).filter((bl) => !bl.deleted);
        const received = bdcReceptionGuard.computeReceivedByArticle(existingBls);
        const ordered = bdcReceptionGuard.computeOrderedByArticle(bdc.items || []);

        const reliquatRejection = bdcReceptionGuard.validateReliquat(bdc.items || [], existingBls, items);
        if (reliquatRejection) {
          return res.status(reliquatRejection.status).json({ success: false, error: reliquatRejection.error });
        }

        const blItemsSaisis = items.map((it) => ({
          article: it.article || "",
          quantite_commandee: parseFloat(it.quantite_commandee) || 0,
          quantite_recue: parseFloat(it.quantite_recue) || 0,
          // Pas de « kg » fabriqué : 85,7 % des lignes de BDC n'ont pas d'unité,
          // et l'inventer ici la transformait en critère de refus plus bas.
          unite: it.unite || "",
          ecart: (parseFloat(it.quantite_recue) || 0) - (parseFloat(it.quantite_commandee) || 0),
          note: it.note || "",
        }));

        // --- IDENTITÉ D'ARTICLE (lib/stock/identiteArticle) ----------------
        //
        // ⚠️ LA RÉCEPTION NE BLOQUE JAMAIS — DÉCISION D'OMAR.
        // Une ligne de BL vient d'un BDC déjà validé par le DG : le magasinier
        // n'a pas choisi ce libellé. Le refuser reviendrait à le punir pour une
        // décision d'achat qui n'est pas la sienne, et à retenir une
        // marchandise physiquement livrée. Mesuré : 16 lignes de BDC en attente
        // sont dans ce cas (rouleau adhésif, film, souffleur, substrat) — du
        // matériel qui n'a pas vocation à être tenu en stock.
        //
        // Donc : la réception est ENREGISTRÉE, la ligne non résolue n'entre PAS
        // en stock (écrire un mouvement sous un libellé non résolu recréerait
        // le solde orphelin que tout ce chantier supprime), elle est MARQUÉE
        // sur le BL, et une demande de création part au DG.
        //
        // Seules les lignes RÉELLEMENT reçues sont examinées — filtre exact de
        // `receptionBdc.lignesDepuisBl` : une ligne commandée mais non livrée
        // n'entre pas en stock, elle n'a donc pas besoin d'identité.
        const blIndexIdentite = await getIdentiteArticleIndex(db_firestore);
        const blLignesRecues = blItemsSaisis.filter((it) => it.quantite_recue > 0);
        const blPartition = demandeCreationArticle.partitionnerLignesReception(
          blLignesRecues,
          blIndexIdentite
        );
        const blDemandes = blPartition.ecartees.length
          ? await enregistrerDemandesCreation(
            db_firestore,
            blPartition.resolutions,
            { uid: authUser.uid, profileId: (created_by || {}).profileId || "", name: (created_by || {}).name || "" },
            { origine: "create-bl", type: "reception", numero: bdc.numero || "" }
          )
          : [];
        // Le BL garde TOUTES ses lignes — c'est le document du fournisseur.
        // Les écartées portent seulement la raison de leur absence du stock :
        // sans cette marque, l'écart entre le BL et le mouvement de réception
        // serait invisible et passerait pour une perte.
        const blItems = demandeCreationArticle.marquerLignesEcartees(
          blItemsSaisis,
          blPartition.ecartees,
          // Le motif est DÉRIVÉ de l'issue de chaque ligne : « absent du
          // catalogue » et « en double au catalogue » appellent des gestes
          // opposés (créer / fusionner). Un motif constant en envoyait un seul,
          // et se trompait dans l'autre cas.
          blPartition.resolutions
        );
        // Table libellé -> docId de fiche, pour les seules lignes retenues.
        const blIdentites = new Map(
          blPartition.retenues.map((it) => [
            it.article || "",
            identiteArticle.identiteImpact(it, blIndexIdentite),
          ])
        );

        // Numéro alloué SEULEMENT maintenant : tous les refus de cette action
        // (BDC absent, statut, reliquat) sont derrière nous. Il était pris plus
        // haut, si bien qu'une réception rejetée consommait un numéro de
        // séquence pour rien.
        const numero = await getNextNumber("delivery_note", "BL");
        const blData = {
          numero, bdc_id, bdc_numero: bdc.numero,
          fournisseur_nom: bdc.fournisseur?.nom || "",
          date_reception: date_reception || new Date().toISOString().split("T")[0],
          numero_bl_fournisseur: numero_bl_fournisseur || "",
          items: blItems,
          scan_url: scan_url || null, scan_id: scan_id || null,
          created_by: created_by || {},
          created_at: Date.now(),
        };
        const docRef = await db_firestore.collection("delivery_notes").add(blData);

        // Update scan record if created from scan
        if (scan_id) {
          await db_firestore.collection("bl_scans").doc(scan_id).update({ bl_id: docRef.id, bl_numero: numero }).catch(() => {});
        }

        // Create stock_movement of type reception — valorisé et EN STOCK immédiatement.
        //
        // L'étape de validation Achats est supprimée : le BDC lié est déjà validé
        // par le DG, et personne ne validait plus depuis le 5 juin (62 réceptions
        // bloquées au 27/08/2026 — un compte qui AUGMENTE tant que ceci n'est pas
        // déployé, leur marchandise jamais entrée en stock). Cf.
        // docs/spec-reception-sans-validation-achats.md.
        //
        // Le prix n'est plus recopié du BDC ici : il est choisi par le module PUR
        // receptionValorisation/prixLigne, qui descend la hiérarchie facture > bon_commande
        // > bon_entree, refuse une unité divergente, et ne pose JAMAIS un prix à
        // zéro par défaut — une ligne sans prix entre en stock NON valorisée, avec
        // son motif tracé. Un stock valorisé à zéro ressemble à un vrai chiffre ;
        // une absence assumée se voit et se corrige.
        // Destination vérifiable AVANT d'écrire quoi que ce soit : la règle vit
        // dans le module (resoudreMagasinDestination), on ne fait que refuser tôt
        // avec un message utile plutôt que de laisser le module lever une 500.
        if (!receptionBdc.resoudreMagasinDestination(req.body.magasin, bdc)) {
          return res.status(400).json({
            success: false,
            error: "Magasin de destination introuvable : choisissez un magasin, ou renseignez la ferme du bon de commande.",
            code: "destination_requise",
          });
        }

        // Numéro BR alloué SEULEMENT s'il y a une réception à créer : sans
        // ligne retenue (BDC 100 % hors catalogue), il n'y a pas de mouvement,
        // et prendre un numéro laisserait un trou dans la séquence.
        const brNumero = blPartition.retenues.length
          ? await getNextNumber("stock_reception", "BR")
          : "";
        // Identité créateur du mouvement de réception : userId = uid du TOKEN
        // (anti-spoof), profileId/name conservés. Cf. stockMovementGuard.
        const brCreatedBy = { ...(created_by || {}), userId: authUser.uid };
        // TOUTES les décisions (lignes retenues, prix, statut) sont prises dans le
        // module pur, donc testées. Ici il ne reste que deux gestes : écrire, et
        // appliquer l'impact stock. La source `facture` n'est pas encore branchée
        // sur Firestore (lot suivant) ; le module l'accepte déjà.
        const brMovement = brNumero ? receptionBdc.construireMouvementReception({
          numero: brNumero,
          // ⚠️ Les lignes RETENUES, jamais `blItems` : une ligne écartée ne
          // doit produire AUCUN mouvement de stock. La lui passer ici la
          // ferait entrer en stock sous son libellé — exactement le solde
          // orphelin que ce lot supprime.
          blItems: blPartition.retenues,
          bdc,
          magasinDemande: req.body.magasin,
          bdcId: bdc_id,
          blId: docRef.id,
          date: date_reception,
          refBlFournisseur: numero_bl_fournisseur,
          scanUrl: scan_url,
          createdBy: brCreatedBy,
        }) : null;
        // null = aucune ligne retenue → aucune réception à créer. Le BL, lui,
        // existe : la livraison est enregistrée même si rien n'entre en stock.
        if (brMovement) {
          // `receptionBdc.lignesDepuisBl` recopie le libellé du BL dans
          // `article_ref` — le module est PUR, il n'a pas le catalogue. On
          // substitue ici le docId de la fiche, en gardant le libellé dans
          // `article_nom` (ce que la valorisation lit en priorité).
          brMovement.items = brMovement.items.map((it) => ({
            ...it,
            article_ref: blIdentites.get(it.article_nom || it.article_ref || "") || it.article_ref,
          }));
          await db_firestore.collection("stock_movements").add(brMovement);
          // Entrée en stock immédiate : c'est ce que l'étape Achats retenait.
          await applyStockImpact(brMovement);
        }

        // Update BDC delivery_status — réutilise received/ordered calculés avant la création du
        // BL, en y ajoutant les quantités du nouveau BL (pas de reduplication de la requête/calcul).
        blItems.forEach((it) => { received[it.article] = (received[it.article] || 0) + (it.quantite_recue || 0); });
        const deliveryStatus = bdcReceptionGuard.deriveDeliveryStatus(ordered, received);
        await db_firestore.collection("purchase_orders").doc(bdc_id).update({ delivery_status: deliveryStatus, updated_at: Date.now() });

        // `numero` est celui du BL. Le numéro du bon de RÉCEPTION (BR) est distinct :
        // l'exposer séparément évite d'annoncer « Réception BL-0042 créée ».
        return res.json({
          success: true, id: docRef.id, numero, delivery_status: deliveryStatus,
          reception_numero: brMovement ? brMovement.numero : null,
          valorisation: brMovement ? brMovement.valorisation : null,
          // Ce qui N'EST PAS entré en stock, et pourquoi. La réception réussit
          // (statut 200) même si zéro ligne est entrée : sans ces champs, la
          // réponse serait un succès muet, et l'appelant ne pourrait pas
          // distinguer « tout est en stock » de « rien ne l'est ».
          // ⚠️ Aucun écran ne les affiche encore — `public/app.jsx` est gelé.
          // C'est la limite N4 remontée par la QA, à lever au dégel.
          lignes_hors_stock: blPartition.ecartees.length,
          demandes_creation: blDemandes,
        });
      }


      // ========== STOCK LEVELS ==========

      if (action === "stock-levels") {
        const ferme = req.query.ferme;
        const cacheKey = "stock_levels" + (ferme ? "_" + ferme : "_all");
        const result = await withCache(cacheKey, 2 * 60 * 1000, async () => {
          const [blSnap, bcSnap] = await Promise.all([
            db_firestore.collection("delivery_notes").get(),
            db_firestore.collection("consumption_vouchers").get(),
          ]);
          const entries = {};
          blSnap.docs.forEach((doc) => {
            const bl = doc.data();
            (bl.items || []).forEach((it) => {
              const key = it.article;
              if (!entries[key]) entries[key] = { article: key, entrees: 0, sorties: 0, unite: it.unite || "kg" };
              entries[key].entrees += it.quantite_recue || 0;
            });
          });
          bcSnap.docs.forEach((doc) => {
            const bc = doc.data();
            if (ferme && bc.ferme !== ferme) return;
            (bc.items || []).forEach((it) => {
              const key = it.article;
              if (!entries[key]) entries[key] = { article: key, entrees: 0, sorties: 0, unite: it.unite || "kg" };
              entries[key].sorties += it.quantite || 0;
            });
          });
          let stocks = Object.values(entries).map((e) => ({
            article: e.article, unite: e.unite,
            entrees: Math.round(e.entrees * 100) / 100,
            sorties: Math.round(e.sorties * 100) / 100,
            stock: Math.round((e.entrees - e.sorties) * 100) / 100,
          }));
          stocks.sort((a, b) => b.stock - a.stock);
          return { success: true, stocks, count: stocks.length };
        });
        return res.json(result);
      }


      // ========== INVOICES (FACTURES) ==========

      if (action === "list-factures") {
        const limit = parseInt(req.query.limit || "200");
        const status = req.query.payment_status;
        let query = db_firestore.collection("invoices").orderBy("created_at", "desc").limit(limit);
        if (status) query = query.where("payment_status", "==", status);
        const snap = await query.get();
        const factures = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, factures });
      }


      if (action === "create-facture" && req.method === "POST") {
        const { bdc_id, numero_facture, date_facture, items, created_by, ferme, scan_url, scan_id } = req.body;
        if (!bdc_id || !numero_facture || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: bdc_id, numero_facture, items[]" });
        }
        // Fetch BDC for discrepancy detection
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (!bdcDoc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = bdcDoc.data();

        // Build BDC lookup by article
        const bdcLookup = {};
        (bdc.items || []).forEach((it) => {
          bdcLookup[it.article] = { quantite: parseFloat(it.quantite) || 0, prix_unitaire: parseFloat(it.prix_unitaire) || 0 };
        });

        // Process items and detect discrepancies
        const discrepancies = [];
        let total_ht = 0, total_tva = 0;
        const facItems = items.map((it) => {
          const qty = parseFloat(it.quantite) || 0;
          const pu = parseFloat(it.prix_unitaire) || 0;
          const tva_rate = parseFloat(it.taux_tva) || 20;
          const mht = qty * pu;
          const mtva = mht * tva_rate / 100;
          total_ht += mht;
          total_tva += mtva;

          // Check discrepancies vs BDC
          const bdcItem = bdcLookup[it.article];
          if (bdcItem) {
            if (qty !== bdcItem.quantite) {
              discrepancies.push({ article: it.article, type: "quantite", bdc_value: bdcItem.quantite, facture_value: qty, ecart: qty - bdcItem.quantite });
            }
            if (pu !== bdcItem.prix_unitaire) {
              discrepancies.push({ article: it.article, type: "prix", bdc_value: bdcItem.prix_unitaire, facture_value: pu, ecart: pu - bdcItem.prix_unitaire });
            }
          }

          return { article: it.article || "", quantite: qty, unite: it.unite || "kg", prix_unitaire: pu, taux_tva: tva_rate, montant_ht: Math.round(mht * 100) / 100, montant_tva: Math.round(mtva * 100) / 100, montant_ttc: Math.round((mht + mtva) * 100) / 100 };
        });

        const numero = await getNextNumber("invoice", "FAC");
        const now = Date.now();
        const facData = {
          numero, numero_facture, bdc_id, bdc_numero: bdc.numero,
          fournisseur: bdc.fournisseur || {},
          date_facture: date_facture || new Date().toISOString().split("T")[0],
          date_saisie: new Date().toISOString().split("T")[0],
          items: facItems, total_ht: Math.round(total_ht * 100) / 100,
          total_tva: Math.round(total_tva * 100) / 100,
          total_ttc: Math.round((total_ht + total_tva) * 100) / 100,
          discrepancies, has_discrepancies: discrepancies.length > 0,
          payment_status: "non_payee", ferme: ferme || bdc.ferme || "",
          created_by: created_by || {},
          scan_url: scan_url || null, scan_id: scan_id || null,
          history: [{ action: "creation", by: created_by || {}, at: now, comment: scan_id ? "Facture créée depuis scan" : "Facture saisie" }],
          created_at: now, updated_at: now,
        };
        const docRef = await db_firestore.collection("invoices").add(facData);

        // Update scan record if created from scan
        if (scan_id) {
          await db_firestore.collection("invoice_scans").doc(scan_id).update({ invoice_id: docRef.id, invoice_numero: numero, updated_at: now }).catch(() => {});
        }

        // Update BDC invoice_status
        const allFacSnap = await db_firestore.collection("invoices").where("bdc_id", "==", bdc_id).get();
        const totalFactured = allFacSnap.docs.reduce((sum, d) => sum + (d.data().total_ttc || 0), 0);
        const invoiceStatus = totalFactured >= (bdc.total_ttc || 0) ? "complet" : totalFactured > 0 ? "partiel" : "non_facture";
        await db_firestore.collection("purchase_orders").doc(bdc_id).update({ invoice_status: invoiceStatus, updated_at: now });

        return res.json({ success: true, id: docRef.id, numero, has_discrepancies: discrepancies.length > 0, discrepancies });
      }


      if (action === "validate-facture" && req.method === "POST") {
        const { id, decision, step, comment, validated_by } = req.body;
        if (!id || !decision || !step) return res.status(400).json({ success: false, error: "ID, décision et étape requis" });

        const doc = await db_firestore.collection("invoices").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Facture non trouvée" });
        const fac = doc.data();

        // Workflow: non_payee -> en_validation -> validee_achats -> validee_finance -> validee_dg -> payee
        const transitions = {
          "submit": { from: "non_payee", to: "en_validation" },
          "achats": { from: "en_validation", to: "validee_achats" },
          "finance": { from: "validee_achats", to: "validee_finance" },
          "dg": { from: "validee_finance", to: "validee_dg" },
          "pay": { from: "validee_dg", to: "payee" },
        };
        const t = transitions[step];
        if (!t) return res.status(400).json({ success: false, error: "Étape invalide" });

        if (decision === "rejete") {
          const now = Date.now();
          await db_firestore.collection("invoices").doc(id).update({
            payment_status: "non_payee", updated_at: now,
            history: [...(fac.history || []), { action: "rejet_" + step, by: validated_by || {}, at: now, comment: comment || "Rejeté" }],
          });
          return res.json({ success: true, status: "non_payee" });
        }

        if (fac.payment_status !== t.from) {
          return res.status(400).json({ success: false, error: `Statut actuel "${fac.payment_status}" incompatible avec l'étape "${step}" (attendu: "${t.from}")` });
        }

        const now = Date.now();
        const updateData = {
          payment_status: t.to, updated_at: now,
          history: [...(fac.history || []), { action: step + "_validation", by: validated_by || {}, at: now, comment: comment || `Validé (${step})` }],
        };
        if (step === "achats") updateData.validated_by_achats = validated_by;
        if (step === "finance") updateData.validated_by_finance = validated_by;
        if (step === "dg") updateData.validated_by_dg = validated_by;
        if (step === "pay") updateData.paid_at = now;

        await db_firestore.collection("invoices").doc(id).update(updateData);
        return res.json({ success: true, status: t.to });
      }


      // ========== CONSUMPTION VOUCHERS (BONS DE CONSOMMATION) ==========

      if (action === "list-bc") {
        const limit = parseInt(req.query.limit || "200");
        const type = req.query.type; // "engrais" or "pesticide"
        const ferme = req.query.ferme;
        let query = db_firestore.collection("consumption_vouchers").orderBy("created_at", "desc").limit(limit);
        if (type) query = query.where("type", "==", type);
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        // Les bons soft-deleted (`delete-bc`) sortent de la liste : sans ce
        // filtre, un doublon supprimé resterait affiché, mouvements annulés.
        const bcs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((bc) => bc.deleted !== true);
        return res.json({ success: true, bcs });
      }

  return NOT_HANDLED;
};
