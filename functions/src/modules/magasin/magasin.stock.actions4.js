/* Actions 4/6 de stockManagement — corps repris VERBATIM.
   Le contexte du handler (req, res, action, helpers) arrive par `ctx` ; la
   destructuration ci-dessous recree exactement les liaisons d'origine, si bien
   que les corps n'ont pas ete touches. */
'use strict';
const { NOT_HANDLED } = require("./_dispatch");
const { admin, bucket, db_firestore, downloadUrl, functions, resolveCallerRole, scanAttachment, bcScan, bcScanJournal, stockFilesRecord, STOCK_FILE_ALLOWED_MIME, STOCK_FILE_ALLOWED_FORMATS_LABEL, getNextNumber, generateRecoForAnalyse } = require("./magasin.stock.deps");

module.exports = async function stockActions4(ctx) {
  const { req, res, action, adminSecret, authUser, updateStockBalance, applyStockImpact, reverseStockImpact, getChefProfileForFerme, resolveRequesterIdentity } = ctx;



      if (action === "update-analyse-foliaire" && req.method === "POST") {
        const { id, statut, bdc_id, comment, updated_by } = req.body;
        if (!id || !statut) return res.status(400).json({ success: false, error: "id et statut requis" });
        const VALID = ["demandee","commandee","prelevee","completee"];
        if (!VALID.includes(statut)) return res.status(400).json({ success: false, error: "Statut invalide" });
        const docRef = db_firestore.collection("analyses_foliaires").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Analyse non trouvée" });
        const current = snap.data();
        const updates = { statut, updated_at: Date.now(), updated_by: updated_by || {} };
        if (bdc_id) updates.bdc_id = bdc_id;
        if (statut === "prelevee" && !current.date_prelevement) updates.date_prelevement = Date.now();
        const history = current.history || [];
        history.push({ action: `passage_${statut}`, by: updated_by || {}, at: Date.now(), comment: comment || "" });
        updates.history = history;
        await docRef.update(updates);
        return res.json({ success: true });
      }


      if (action === "upload-scan-analyse" && req.method === "POST") {
        const { id, scan_base64, filename, uploaded_by } = req.body;
        if (!id || !scan_base64) return res.status(400).json({ success: false, error: "id et scan_base64 requis" });
        const docRef = db_firestore.collection("analyses_foliaires").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Analyse non trouvée" });
        const buffer = Buffer.from(scan_base64.replace(/^data:image\/\w+;base64,|^data:application\/pdf;base64,/, ""), "base64");
        const ext = (filename || "scan.pdf").split(".").pop() || "pdf";
        const storagePath = `analyses_foliaires/${id}/scan_resultat.${ext}`;
        const contentType = ext === "pdf" ? "application/pdf" : `image/${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        const current = snap.data();
        const history = current.history || [];
        history.push({ action: "upload_scan", by: uploaded_by || {}, at: Date.now(), comment: "" });
        await docRef.update({ scan_resultat_url: scan_url, date_resultat: Date.now(), statut: "completee", history, updated_at: Date.now() });
        return res.json({ success: true, scan_url });
      }


      // ========== SURVEILLANCE AGRO — observation terrain (photos) ==========

      if (action === "create-observation-terrain" && req.method === "POST") {
        const { ferme, variete, culture, note, photos, created_by } = req.body;
        if (!ferme) return res.status(400).json({ success: false, error: "ferme requis" });
        if (!variete) return res.status(400).json({ success: false, error: "variete requis" });
        if (!photos || !photos.length) return res.status(400).json({ success: false, error: "au moins 1 photo requise" });
        if (photos.length > 5) return res.status(400).json({ success: false, error: "max 5 photos" });

        const now = Date.now();
        const docData = {
          type_analyse: "observation_terrain",
          ferme,
          variete,
          culture: culture || null,
          parcelle: null,
          date_analyse: now,
          statut: "completee",
          source: "manual",
          photo_urls: [],
          note_demande: note || "",
          parsed_values: {},
          recommandations_ia: [],
          terrain_raw: note || "",
          created_by: created_by || { name: "unknown" },
          created_at: now,
          updated_at: now,
        };
        const ref = await db_firestore.collection("analyses_foliaires").add(docData);

        const photoUrls = [];
        for (let i = 0; i < photos.length; i++) {
          const p = photos[i];
          const cleanBase64 = (p.base64 || "").replace(/^data:image\/\w+;base64,/, "");
          if (!cleanBase64) continue;
          const buffer = Buffer.from(cleanBase64, "base64");
          const storagePath = `analyses_foliaires/${ref.id}/photos/${now}_${i}.jpg`;
          const file = bucket.file(storagePath);
          await file.save(buffer, { metadata: { contentType: "image/jpeg" } });
          const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
          photoUrls.push({
            url,
            storage_path: storagePath,
            caption: p.caption || "",
            taken_at: now,
            location: p.location || null,
          });
        }

        const firstGeo = photoUrls.find(p => p.location);
        const updateData = { photo_urls: photoUrls, updated_at: Date.now() };
        if (firstGeo) updateData.location = firstGeo.location;
        await ref.update(updateData);
        return res.json({ success: true, id: ref.id, photo_count: photoUrls.length });
      }


      if (action === "import-analyse-agq" && req.method === "POST") {
        const { pdf_base64, filename, source_email, created_by } = req.body;
        if (!pdf_base64) return res.status(400).json({ success: false, error: "pdf_base64 requis" });
        const { parseAgqPdf } = require("../../../agqParser");
        const pdfBuffer = Buffer.from(pdf_base64.replace(/^data:application\/pdf;base64,/, ""), "base64");

        let parsed;
        try {
          parsed = await parseAgqPdf(pdfBuffer, {
            subject: source_email?.subject || "",
            attachmentName: filename || "",
          });
        } catch (e) {
          return res.status(500).json({ success: false, error: "Parse AGQ: " + e.message });
        }

        if (!parsed.ferme) {
          return res.status(422).json({ success: false, error: "Ferme non détectée dans le PDF", parsed });
        }

        // Idempotence: skip if we already imported this exact attachment.
        if (source_email?.messageId && filename) {
          const dup = await db_firestore.collection("analyses_foliaires")
            .where("source_email.messageId", "==", source_email.messageId)
            .where("source_email.attachment_name", "==", filename)
            .limit(1)
            .get();
          if (!dup.empty) {
            return res.json({ success: true, skipped: true, id: dup.docs[0].id, reason: "duplicate" });
          }
        }

        const numero = await getNextNumber("analyse_foliaire", "AF");
        const now = Date.now();
        const receivedAt = source_email?.received_at ? new Date(source_email.received_at).getTime() : now;
        const data = {
          numero,
          ferme: parsed.ferme,
          parcelle: null,
          culture: parsed.culture,
          type_analyse: parsed.type_analyse,
          variete: parsed.variete,
          propriete_raw: parsed.propriete_raw,
          terrain_raw: parsed.terrain_raw,
          client_raw: parsed.client_raw,
          phenologie: parsed.phenologie,
          parsed_values: parsed.parsed_values || {},
          parsed_header_line: parsed.parsed_header_line || null,
          source: "email_agq",
          source_email: {
            messageId: source_email?.messageId || null,
            subject: source_email?.subject || null,
            from: source_email?.from || null,
            received_at: receivedAt,
            attachment_name: filename || null,
          },
          statut: "completee",
          date_demande: receivedAt,
          date_prelevement: parsed.date_analyse || receivedAt,
          date_resultat: receivedAt,
          date_analyse: parsed.date_analyse || null,
          bdc_id: null,
          photo_parcelle_url: null,
          scan_resultat_url: null,
          note_demande: "",
          recommandations_ia: [],
          history: [{ action: "import_email_agq", by: created_by || { name: "system" }, at: now, comment: filename || "" }],
          created_by: created_by || { name: "system" },
          created_at: now,
          updated_at: now,
        };
        const ref = await db_firestore.collection("analyses_foliaires").add(data);

        // Upload the PDF as the analysis result scan.
        try {
          const safeName = (filename || "agq_report.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
          const storagePath = `analyses_foliaires/${ref.id}/${safeName}`;
          const file = bucket.file(storagePath);
          await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });
          const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
          await ref.update({ scan_resultat_url: url });
          data.scan_resultat_url = url;
        } catch (e) {
          console.error("Upload PDF AGQ:", e.message);
        }

        return res.json({ success: true, id: ref.id, numero, parsed });
      }


      if (action === "generate-reco-foliaire" && req.method === "POST") {
        const result = await generateRecoForAnalyse(req.body.id, req.body);
        if (result.success) return res.json(result);
        return res.json(result);
      }



      // ========== SCAN FACTURES (AI-powered invoice scanning) ==========

      if (action === "scan-facture" && req.method === "POST") {
        const { scan_base64, filename, ferme, created_by } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.pdf").split(".").pop().toLowerCase() || "pdf";
        const ts = Date.now();
        const storagePath = `scans/factures/${ts}_${filename || "scan." + ext}`;
        const contentType = ext === "pdf" ? "application/pdf" : `image/${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Prepare content for Claude AI
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const messageContent = [];
        const isImage = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
        const isPdf = ext === "pdf";

        if (isImage) {
          const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          messageContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } });
        } else if (isPdf) {
          // Try text extraction first (pdf-parse v2 API via shared helper)
          const pdfText = await scanAttachment.extractPdfText(buffer);

          if (pdfText.length > 50) {
            messageContent.push({ type: "text", text: "CONTENU TEXTE DU PDF:\n" + pdfText });
          } else {
            // Scanned PDF - send as document to Claude
            messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 } });
          }
        }

        const currentYear = new Date().getFullYear();
        const FACTURE_PROMPT = `Tu es un assistant spécialisé dans l'analyse de factures fournisseur pour Berry Good Farms.

ÉTAPE 1 - VÉRIFICATION (les 3 conditions doivent être remplies, sinon ACCEPTE):
1. Le nom du client sur la facture contient "BERRY GOOD" ou "BGF" (peu importe la forme juridique ou la ville)
2. Une adresse postale du client est mentionnée (n'importe quelle adresse au Maroc)
3. Un numéro ICE client est présent (nos ICE: 002106859000069 ou 001536944000082)
4. La date de la facture est de l'année ${currentYear}

IMPORTANT: Berry Good Farms a PLUSIEURS sites au Maroc (Agadir, Laarache, etc). Ne rejette PAS à cause de la ville ou l'adresse. Accepte tant que le nom contient "BERRY GOOD" ou "BGF".
Si ce n'est clairement PAS une facture pour Berry Good Farms → REJETTE avec explication.

ÉTAPE 2 - EXTRACTION DES DONNÉES:
Extrais les champs suivants en JSON strict:
{
  "accepted": true/false,
  "rejection_reason": "..." (si rejeté, explique pourquoi),
  "fournisseur": { "nom": "...", "ice": "...", "adresse": "..." },
  "numero_facture": "...",
  "date_facture": "YYYY-MM-DD",
  "date_echeance": "YYYY-MM-DD",
  "items": [
    { "article": "...", "quantite": 0, "unite": "...", "prix_unitaire": 0, "taux_tva": 20, "montant_ht": 0 }
  ],
  "total_ht": 0,
  "total_tva": 0,
  "total_ttc": 0,
  "confidence": 0.0,
  "notes": "..."
}

IMPORTANT: Retourne UNIQUEMENT le JSON, sans texte avant ou après. Les montants sont en MAD (Dirhams marocains). Si un champ n'est pas lisible, mets null.`;

        messageContent.push({ type: "text", text: FACTURE_PROMPT });

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-facture", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const aiText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis;
        try {
          // Try to extract JSON from the response
          const jsonMatch = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA impossible - réponse non structurée", raw: aiText });
        }

        // 4) BDC Matching (if accepted)
        let matched_bdc = null;
        if (analysis.accepted) {
          const fournisseurNom = (analysis.fournisseur?.nom || "").toLowerCase().trim();
          const totalTtc = parseFloat(analysis.total_ttc) || 0;

          // Try matching by fournisseur name
          if (fournisseurNom) {
            const bdcSnap = await db_firestore.collection("purchase_orders")
              .where("status", "in", ["valide_dg", "envoye"])
              .orderBy("created_at", "desc").limit(100).get();

            const candidates = bdcSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(b => {
                const bNom = (b.fournisseur?.nom || "").toLowerCase().trim();
                return bNom.includes(fournisseurNom) || fournisseurNom.includes(bNom);
              });

            if (candidates.length > 0) {
              // Rank by amount proximity
              candidates.sort((a, b) => {
                const aDiff = Math.abs((a.total_ttc || 0) - totalTtc);
                const bDiff = Math.abs((b.total_ttc || 0) - totalTtc);
                return aDiff - bDiff;
              });
              const best = candidates[0];
              const ecartPct = totalTtc > 0 ? Math.abs((best.total_ttc || 0) - totalTtc) / totalTtc * 100 : 100;
              matched_bdc = {
                id: best.id, numero: best.numero,
                fournisseur_nom: best.fournisseur?.nom || "",
                total_ttc: best.total_ttc || 0,
                ecart_pct: Math.round(ecartPct * 10) / 10,
                confidence: ecartPct < 5 ? "high" : ecartPct < 15 ? "medium" : "low",
                all_candidates: candidates.slice(0, 5).map(c => ({ id: c.id, numero: c.numero, total_ttc: c.total_ttc })),
              };
            }
          }
        }

        // 5) Save scan metadata to Firestore
        const scanData = {
          scan_url, scan_filename: filename || "scan." + ext, scan_type: isImage ? "image" : "pdf",
          status: analysis.accepted ? "accepted" : "rejected",
          rejection_reason: analysis.rejection_reason || null,
          analysis, matched_bdc_id: matched_bdc?.id || null, matched_bdc_numero: matched_bdc?.numero || null,
          invoice_id: null, invoice_numero: null, ferme: ferme || "",
          created_by: created_by || {}, created_at: ts, updated_at: ts,
        };
        const scanDocRef = await db_firestore.collection("invoice_scans").add(scanData);

        return res.json({ success: true, scan_id: scanDocRef.id, scan_url, analysis, matched_bdc });
      }


      // ========== SCAN BL (AI-powered delivery note scanning) ==========

      if (action === "scan-bl" && req.method === "POST") {
        const { scan_base64, filename, created_by } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.pdf").split(".").pop().toLowerCase() || "pdf";
        const ts = Date.now();
        const storagePath = `scans/bl/${ts}_${filename || "scan." + ext}`;
        const contentType = ext === "pdf" ? "application/pdf" : `image/${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Prepare content for Claude AI
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const messageContent = [];
        const isImage = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
        const isPdf = ext === "pdf";

        if (isImage) {
          const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          messageContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } });
        } else if (isPdf) {
          // pdf-parse v2 API via shared helper
          const pdfText = await scanAttachment.extractPdfText(buffer);

          if (pdfText.length > 50) {
            messageContent.push({ type: "text", text: "CONTENU TEXTE DU PDF:\n" + pdfText });
          } else {
            messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 } });
          }
        }

        const BL_PROMPT = `Tu es un assistant spécialisé dans l'analyse de bons de livraison (BL) pour Berry Good Farms SARL.

Extrais les données du bon de livraison en JSON strict:
{
  "fournisseur_nom": "...",
  "date_reception": "YYYY-MM-DD",
  "numero_bl_fournisseur": "...",
  "numero_bdc_reference": "..." (si un numéro de bon de commande est mentionné, sinon null),
  "items": [
    { "article": "...", "quantite_recue": 0, "unite": "...", "lot": "..." }
  ],
  "notes": "..."
}

IMPORTANT: Retourne UNIQUEMENT le JSON, sans texte avant ou après. Si un champ n'est pas lisible, mets null.`;

        messageContent.push({ type: "text", text: BL_PROMPT });

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-bl", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const aiText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis;
        try {
          const jsonMatch = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA impossible - réponse non structurée", raw: aiText });
        }

        // 4) BDC Matching
        let matched_bdc = null;
        const fournisseurNom = (analysis.fournisseur_nom || "").toLowerCase().trim();
        const bdcRef = analysis.numero_bdc_reference;

        // Try by BDC number reference first
        if (bdcRef) {
          const bdcSnap = await db_firestore.collection("purchase_orders")
            .where("numero", "==", bdcRef).limit(1).get();
          if (!bdcSnap.empty) {
            const d = bdcSnap.docs[0];
            matched_bdc = { id: d.id, numero: d.data().numero, fournisseur_nom: d.data().fournisseur?.nom || "", items: d.data().items || [], confidence: "high" };
          }
        }

        // Fallback: match by fournisseur name
        if (!matched_bdc && fournisseurNom) {
          const bdcSnap = await db_firestore.collection("purchase_orders")
            .where("status", "in", ["valide_dg", "envoye"])
            .orderBy("created_at", "desc").limit(100).get();
          const candidates = bdcSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(b => {
              const bNom = (b.fournisseur?.nom || "").toLowerCase().trim();
              return bNom.includes(fournisseurNom) || fournisseurNom.includes(bNom);
            })
            .filter(b => b.delivery_status !== "complet");

          if (candidates.length > 0) {
            const best = candidates[0];
            matched_bdc = {
              id: best.id, numero: best.numero,
              fournisseur_nom: best.fournisseur?.nom || "",
              items: best.items || [],
              confidence: "medium",
              all_candidates: candidates.slice(0, 5).map(c => ({ id: c.id, numero: c.numero })),
            };
          }
        }

        // 5) Save scan metadata
        const scanData = {
          scan_url, scan_filename: filename || "scan." + ext, scan_type: isImage ? "image" : "pdf",
          analysis, matched_bdc_id: matched_bdc?.id || null, matched_bdc_numero: matched_bdc?.numero || null,
          bl_id: null, bl_numero: null,
          created_by: created_by || {}, created_at: ts,
        };
        const scanDocRef = await db_firestore.collection("bl_scans").add(scanData);

        return res.json({ success: true, scan_id: scanDocRef.id, scan_url, analysis, matched_bdc });
      }


      // ========== UNIFIED ATTACHMENT (client-direct upload model) ==========
      // The file is uploaded DIRECTLY from the client to Firebase Storage
      // (bypasses the 10 MB CF payload limit). This action only records the
      // metadata on the target doc and returns a V4 signed read URL.
      if (action === "upload-attachment" && req.method === "POST") {
        const { entity_type, entity_id, scan_path, filename } = req.body || {};
        const validation = scanAttachment.utils.validateUploadAttachmentParams({ entity_type, entity_id, scan_path, filename });
        if (!validation.valid) return res.status(400).json({ success: false, error: validation.error });

        const collection = scanAttachment.utils.collectionForEntity(entity_type);
        const docRef = db_firestore.collection(collection).doc(entity_id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return res.status(404).json({ success: false, error: "Document cible introuvable" });

        // Confirm the object actually exists in the bucket before recording it.
        let exists = false;
        try { [exists] = await bucket.file(scan_path).exists(); } catch (_) { exists = false; }
        if (!exists) return res.status(400).json({ success: false, error: "Fichier introuvable dans le stockage (upload incomplet ?)" });

        // SERVER-SIDE ENFORCEMENT (replaces the size/MIME constraints removed
        // from the Storage rules — unreliable on resumable/mobile uploads).
        // Read the real object metadata and validate BEFORE writing any link.
        // A rejected object is deleted so no orphan object/link is left behind.
        let objMeta = null;
        try { [objMeta] = await bucket.file(scan_path).getMetadata(); } catch (_) { objMeta = null; }
        if (!objMeta) return res.status(400).json({ success: false, error: "Métadonnées du fichier illisibles" });
        const metaCheck = scanAttachment.validateAttachmentMetadata({ size: objMeta.size, contentType: objMeta.contentType });
        if (!metaCheck.valid) {
          try { await bucket.file(scan_path).delete(); } catch (_) { /* best effort cleanup */ }
          return res.status(400).json({ success: false, error: metaCheck.error });
        }

        const signedUrl = await scanAttachment.generateSignedUrl(bucket, scan_path);
        const now = Date.now();
        const uploadedBy = {
          uid: authUser.uid || null,
          email: authUser.email || null,
          name: (req.body.uploaded_by && req.body.uploaded_by.name) || null,
          profileId: (req.body.uploaded_by && req.body.uploaded_by.profileId) || null,
        };
        await docRef.update({
          scan_url: signedUrl || null,
          scan_path,
          scan_filename: filename || scanAttachment.utils.sanitizeFilename(filename),
          scan_uploaded_at: now,
          scan_uploaded_by: uploadedBy,
          updated_at: now,
        });

        return res.json({ success: true, scan_url: signedUrl, scan_path, scan_uploaded_at: now });
      }


      // Generate (or refresh) a V4 signed read URL for an existing attachment.
      // Used by the list viewers so we never expose a public/no-ACL URL (cause C).
      if (action === "get-attachment-url") {
        const entityType = req.query.entity_type;
        const entityId = req.query.entity_id;
        if (!scanAttachment.utils.isValidEntityType(entityType)) {
          return res.status(400).json({ success: false, error: "entity_type invalide" });
        }
        if (!entityId) return res.status(400).json({ success: false, error: "entity_id requis" });
        const collection = scanAttachment.utils.collectionForEntity(entityType);
        const docSnap = await db_firestore.collection(collection).doc(entityId).get();
        if (!docSnap.exists) return res.status(404).json({ success: false, error: "Document introuvable" });
        const data = docSnap.data();
        const scanPath = data.scan_path || null;
        if (!scanPath) return res.json({ success: true, scan_url: null });
        const signedUrl = await scanAttachment.generateSignedUrl(bucket, scanPath);
        return res.json({ success: true, scan_url: signedUrl, scan_path: scanPath });
      }


      // ========== SOUMISSION FICHIERS STOCK (magasinier) ==========
      // docs/spec-collecte-stock-magasinier.md §4.1. Écriture partagée par les
      // 2 canaux (app + WhatsApp) via functions/lib/stockFiles/recordSubmission.js.
      // Le fichier est uploadé CLIENT-DIRECT vers Storage (même modèle que
      // upload-attachment) ; cette action ne fait que valider + enregistrer.

      if (action === "stock-file-submit" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body — cf.
        // commentaire fonctions/index.js:5121 et CLAUDE.md.
        const callerRole = await resolveCallerRole(authUser);
        if (callerRole !== "magasinier" && callerRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }

        const { farm, storage_path, filename } = req.body || {};
        if (!stockFilesRecord.isValidFarm(farm)) {
          return res.status(400).json({ success: false, error: "farm invalide (attendu: berry_good|bahia)" });
        }
        if (!storage_path) {
          return res.status(400).json({ success: false, error: "storage_path requis" });
        }

        // Confirme que l'objet existe réellement dans le bucket avant de l'enregistrer.
        let exists = false;
        try { [exists] = await bucket.file(storage_path).exists(); } catch (_) { exists = false; }
        if (!exists) return res.status(400).json({ success: false, error: "Fichier introuvable dans le stockage (upload incomplet ?)" });

        // ENFORCEMENT SERVEUR taille/MIME — même fonction que upload-attachment
        // (pas de règle dupliquée entre les flux d'upload). Objet rejeté → suppression
        // best-effort pour ne laisser aucun orphelin.
        let objMeta = null;
        try { [objMeta] = await bucket.file(storage_path).getMetadata(); } catch (_) { objMeta = null; }
        if (!objMeta) return res.status(400).json({ success: false, error: "Métadonnées du fichier illisibles" });
        const metaCheck = scanAttachment.validateAttachmentMetadata({ size: objMeta.size, contentType: objMeta.contentType }, STOCK_FILE_ALLOWED_MIME);
        if (!metaCheck.valid) {
          try { await bucket.file(storage_path).delete(); } catch (_) { /* best effort cleanup */ }
          const error = /non autorisé/.test(metaCheck.error)
            ? `${metaCheck.error} (formats acceptés : ${STOCK_FILE_ALLOWED_FORMATS_LABEL})`
            : metaCheck.error;
          return res.status(400).json({ success: false, error });
        }

        // Date TOUJOURS calculée côté serveur (Africa/Casablanca) — jamais
        // l'horloge client (cf. spec §4.1 et CLAUDE.md).
        const date = stockFilesRecord.todayInCasablanca();
        const submittedBy = {
          uid: authUser.uid || null,
          name: (req.body.submitted_by && req.body.submitted_by.name) || authUser.name || authUser.email || null,
          email: authUser.email || null,
          source: "app",
        };

        const result = await stockFilesRecord.recordSubmission(
          { db: db_firestore, serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp() },
          { date, farm, storagePath: storage_path, filename, submittedBy }
        );
        if (!result.success) return res.status(400).json(result);
        return res.json({ success: true, submitted_at: Date.now() });
      }


      if (action === "stock-file-history") {
        const daysParam = parseInt(req.query.days || "30", 10);
        const days = Math.min(Math.max(Number.isFinite(daysParam) ? daysParam : 30, 1), 90);
        const today = stockFilesRecord.todayInCasablanca();

        const dates = [];
        for (let i = 0; i < days; i++) dates.push(stockFilesRecord.addDaysStr(today, -i));

        const results = await Promise.all(dates.map(async (date) => {
          const snap = await db_firestore.collection(stockFilesRecord.COLLECTION).doc(date).get();
          const doc = snap.exists ? snap.data() : stockFilesRecord.emptySubmissionDoc(date);
          const toMillis = (ts) => (ts && typeof ts.toMillis === "function") ? ts.toMillis() : (ts || null);
          return {
            date,
            berry_good: {
              submitted: !!(doc.berry_good && doc.berry_good.submitted),
              submitted_at: toMillis(doc.berry_good && doc.berry_good.submitted_at),
              submitted_by: (doc.berry_good && doc.berry_good.submitted_by) || null,
            },
            bahia: {
              submitted: !!(doc.bahia && doc.bahia.submitted),
              submitted_at: toMillis(doc.bahia && doc.bahia.submitted_at),
              submitted_by: (doc.bahia && doc.bahia.submitted_by) || null,
            },
          };
        }));
        // Déjà du plus récent au plus ancien (dates construites par soustraction depuis today).
        return res.json({ success: true, days: results });
      }


      // AJOUTÉ le 2026-08-05 (spec §4.1) — consultation/téléchargement d'un
      // fichier stock déjà soumis. Mêmes rôles que stock-file-history, résolus
      // SERVEUR (resolveCallerRole) — jamais depuis le body/query client.
      if (action === "stock-file-download-url") {
        const callerRole = await resolveCallerRole(authUser);
        if (callerRole !== "magasinier" && callerRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }

        const date = req.query.date;
        const farm = req.query.farm;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return res.status(400).json({ success: false, error: "date invalide (YYYY-MM-DD requis)" });
        }
        if (!stockFilesRecord.isValidFarm(farm)) {
          return res.status(400).json({ success: false, error: "farm invalide (attendu: berry_good|bahia)" });
        }

        const snap = await db_firestore.collection(stockFilesRecord.COLLECTION).doc(date).get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Aucune soumission pour cette date" });
        const doc = snap.data();
        const filePath = doc[farm] && doc[farm].file_path;
        if (!filePath) return res.status(404).json({ success: false, error: "Aucun fichier soumis pour cette ferme ce jour-là" });

        const downloadUrl = await scanAttachment.generateSignedUrl(bucket, filePath);
        return res.json({ success: true, download_url: downloadUrl, file_name: (doc[farm] && doc[farm].file_name) || null });
      }


      // ========== SCAN HISTORY ==========

      if (action === "list-scan-history") {
        const type = req.query.type || "facture"; // "facture" or "bl"
        const limit = parseInt(req.query.limit || "50");
        const collection = type === "bl" ? "bl_scans" : "invoice_scans";
        const snap = await db_firestore.collection(collection).orderBy("created_at", "desc").limit(limit).get();
        const scans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, scans });
      }


      // ========== SCAN BON D'APPORT (AI-powered production bon scanning) ==========

      if (action === "scan-bon-apport" && req.method === "POST") {
        const { scan_base64, filename, created_by } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.jpg").split(".").pop().toLowerCase() || "jpg";
        const ts = Date.now();
        const storagePath = `scans/bons_apport/${ts}_${filename || "scan." + ext}`;
        const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Prepare content for Claude AI
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        const messageContent = [
          { type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } },
          { type: "text", text: `Tu es un assistant spécialisé dans la lecture de bons d'apport de production agricole pour Berry Good Farms (culture de framboise et myrtille au Maroc).

DATE IMPORTANTE: Nous sommes en ${new Date().toISOString().split('T')[0]}. Les bons scannés datent généralement de J-1 ou J-2 (hier ou avant-hier). L'année est TOUJOURS 2026 (saison 2025-2026). Si tu lis une date ambiguë, utilise 2026 comme année.

Extrais les données du bon d'apport en JSON strict:
{
  "numero_bon": "..." (numéro du bon d'apport, souvent en haut du document en rouge),
  "date": "YYYY-MM-DD" (date de récolte — sur le bon elle est au format français JJ/MM/AAAA, convertis en YYYY-MM-DD. L'année est 2026),
  "ferme": "F1" ou "F5" (IMPORTANT: détermine la ferme par le secteur/parcelle: S1-S7 et GG → F1, S8, S8-1, S8-2, S9, S10, S13 → F5. Aussi par N° Camion: 172 → F1, 195 → F5. Cherche dans "Producteur / Ferme" ou "Parcelle / Bloc"),
  "variete": "..." (désignation EXACTE du bloc — utilise une de ces valeurs: "MARAVILLA GG F1", "S10 YAZMIN CUT BACK F5", "S9 REYNA F5", "CORINA MYRTILLE S8", "BREEZE MYRTILLE S8-2", "CASCADE MYRTILLE S8-1". Identifie la variété et la ferme pour choisir la bonne désignation),
  "parcelle": "..." (parcelle/bloc si mentionné),
  "lignes": [
    {
      "description": "..." (type d'unité de livraison, ex: "Carton Driscoll's Barquette en quarton 10x300g PPE". Pour Marché Local, inclure le nom de la variété si visible),
      "variete": "..." (variété de cette ligne si identifiable — utiliser les mêmes désignations que le champ variete ci-dessus. Important pour les bons Marché Local multi-variétés),
      "nombre_colis": 0 (nombre dans la colonne "Nombre"),
      "poids_unitaire_kg": 0 (quantité de produit par unité de chargement en kg, ex: 3 pour "163 x3"),
      "quantite_kg": 0 (quantité totale en kg pour cette ligne)
    }
  ],
  "poids_kg": 0 (poids TOTAL de toutes les lignes en kg — somme des quantite_kg),
  "nombre_colis_total": 0 (somme de tous les nombre_colis),
  "type_vente": "Export" ou "Marché Local" (si mentionné, sinon "Export"),
  "client": "..." (nom du client si mentionné, sinon "Driscoll's" pour export),
  "semaine": "..." (numéro de semaine si mentionné, sinon null),
  "notes": "..." (informations supplémentaires, traitement phytosanitaire, etc.)
}

IMPORTANT:
- Retourne UNIQUEMENT le JSON, sans texte avant ou après
- Le numéro de bon est crucial — cherche-le attentivement (souvent en rouge en haut)
- Lis CHAQUE ligne du tableau "Type d'unité de livraison" séparément
- Vérifie que la somme des quantite_kg des lignes = poids_kg total
- Pour les bons "Marché Local", un même bon peut contenir PLUSIEURS variétés — identifie la variété de chaque ligne et remplis le champ "variete" de chaque ligne
- Si un champ n'est pas lisible, mets null` }
        ];

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 1500, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-bon-apport", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const aiText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis;
        try {
          const jsonMatch = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA impossible - réponse non structurée", raw: aiText });
        }

        return res.json({ success: true, scan_url, analysis });
      }


      // ========== SCAN BON DE CONSOMMATION INTERNE (matrice piles x articles) ==========
      // Toute la logique métier vit dans functions/lib/stock/bcScan.js (module PUR,
      // couvert par tests/unit/bcScan.test.js). Ici : upload + appel vision +
      // rapprochement catalogue/parcelles. AUCUNE écriture métier : le BC n'est
      // créé qu'ensuite, par l'action `create-bc` inchangée.

      if (action === "scan-bc" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body — même
        // garde que save-bc-scan-alias. Sans elle, n'importe quel profil
        // authentifié (chef, RH, ouvrier) pourrait déclencher un appel Opus et
        // un upload Storage, alors que le bouton n'est exposé qu'au magasinier.
        const scanBcRole = await resolveCallerRole(authUser);
        if (scanBcRole !== "magasinier" && scanBcRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }

        const { scan_base64, filename, type } = req.body || {};
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Type MIME RÉEL du scan — déduit du préfixe data-url, PAS de
        //    l'extension du filename : le client ré-encode toujours en JPEG
        //    (public/lib/imageDownscale.js), donc « bon.png » porte des octets
        //    JPEG. Cf. bcScan.resolveScanMedia (module pur, testé). Le même
        //    mediaType sert à l'appel vision ET au contentType Storage.
        const rawName = String(filename || "scan.jpg");
        const media = bcScan.resolveScanMedia(scan_base64, rawName);
        if (!media.ok) return res.status(400).json({ success: false, error: media.error });
        const mediaType = media.mediaType;

        // Taille bornée pour ne pas saturer la mémoire de la function.
        const cleanBase64 = scan_base64.replace(/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+\s*;\s*base64,/i, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const BC_SCAN_MAX_BYTES = 8 * 1024 * 1024;
        if (buffer.length > BC_SCAN_MAX_BYTES) {
          const mo = (buffer.length / (1024 * 1024)).toFixed(1);
          return res.status(400).json({ success: false, error: `Image trop lourde (${mo} Mo) : maximum 8 Mo` });
        }

        // 2) Upload du scan (trace + pièce jointe du futur BC).
        const ts = Date.now();
        const storagePath = `scans/bons_consommation/${ts}_${rawName}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType: mediaType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 3) Référentiels — lus AVANT l'appel vision, car ils alimentent
        //    désormais le VOCABULAIRE injecté dans le prompt (et non plus
        //    seulement le rapprochement d'après-coup).
        //    `consumption_vouchers` est borné aux 200 bons les plus récents :
        //    on ne cherche qu'à savoir ce que le magasinier consomme vraiment,
        //    pas à parcourir l'historique complet à chaque photo.
        const [artSnapBc, aliasSnapBc, bonsSnapBc] = await Promise.all([
          db_firestore.collection("articles_catalog").where("active", "==", true).get(),
          db_firestore.collection("bc_scan_aliases").get(),
          db_firestore.collection("consumption_vouchers").orderBy("date", "desc").limit(200).get()
            .catch(() => null),
        ]);
        const catalogueBc = artSnapBc.docs
          .map(d => ({ nom: (d.data() || {}).nom || "", categorie: (d.data() || {}).categorie || "" }))
          .filter(a => a.nom);
        // Noms d'articles vus dans les bons récents. Panne de lecture (index
        // manquant sur `date`) -> liste vide : le vocabulaire retombe sur le
        // seul filtre de catégorie, jamais d'erreur remontée au magasinier.
        const consommesBc = [];
        if (bonsSnapBc) {
          bonsSnapBc.forEach((d) => {
            const items = (d.data() || {}).items;
            if (!Array.isArray(items)) return;
            items.forEach((it) => { if (it && it.article) consommesBc.push(String(it.article)); });
          });
        }

        // 4) Appel vision. `today` est INJECTÉ dans le prompt : aucune année en
        //    dur (défaut du prompt scan-bon-apport, figé sur 2026).
        const today = new Date().toISOString().split("T")[0];
        const Anthropic = require("@anthropic-ai/sdk");
        const bcClient = new Anthropic({ apiKey });
        // VOCABULAIRE injecté dans le prompt (lot B) : ARTICLES UNIQUEMENT.
        //
        // ⚠️ L'absence de vocabulaire de PARCELLES est un RETRAIT MESURÉ, pas un
        // oubli — ne pas le « rétablir » en croyant corriger une omission. Le
        // paramètre `parcelles` de buildBcScanPrompt existe toujours et reste
        // testé : seule l'alimentation depuis cette action a été retirée.
        // Mesuré sur les 7 bons de référence, 4 passages : 29/73 parcelles
        // pré-remplies AVEC la liste, 29/73 SANS. Aucun bénéfice, ~200 tokens
        // par image, et une surface de risque de forçage en plus sur la donnée
        // la plus coûteuse à se tromper (une consommation imputée à la mauvaise
        // parcelle est invisible). Le rapprochement des parcelles se fait côté
        // front (§5) et leur apprentissage par les alias du lot A.
        const bcPrompt = bcScan.buildBcScanPrompt({
          today,
          articles: bcScan.selectVocabArticles(catalogueBc, type || "", consommesBc),
        });
        // Ordre VOLONTAIRE : texte (stable au sein d'un lot) d'abord avec le
        // point de cache, image (variable) ensuite. Inversé, le préfixe ne
        // serait plus cachable. `cache_control` n'engage la mise en cache qu'au
        // delà du minimum de tokens du modèle ; en-dessous, l'appel se comporte
        // exactement comme avant (aucune erreur, aucun surcoût).
        const bcMessageContent = [
          { type: "text", text: bcPrompt, cache_control: { type: "ephemeral" } },
          { type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } },
        ];
        // Modèles — choix issu de la skill `claude-api` (source de vérité des ids
        // de modèles ; à reconsulter AVANT toute modification de cette liste).
        // - claude-opus-5 = modèle par défaut actuel (vision incluse) ;
        //   claude-opus-4-8 = repli d'une génération.
        // - Les ids sont COMPLETS tels quels : ne JAMAIS y ajouter un suffixe de
        //   date. Ne pas régresser vers les snapshots figés de mai 2025 encore
        //   utilisés par les autres actions scan-*.
        // - `budget_tokens` et le prefill de message assistant sont bien rejetés
        //   en 400 sur cette génération. En revanche le sujet du raisonnement
        //   n'est PAS clos : sur claude-opus-5 le raisonnement adaptatif est
        //   ACTIF PAR DÉFAUT (contrairement à opus-4-8), et sa profondeur se
        //   pilote par `output_config.effort` — GA, sans en-tête beta, et
        //   uniquement DANS `output_config`, jamais à la racine du corps.
        // - On demande `effort: "low"` : lire un bon est une TRANSCRIPTION
        //   structurée, pas un problème de raisonnement. Mesuré sur les 7 bons
        //   de référence, 2 balayages entrelacés low/medium/high :
        //   fidélité IDENTIQUE aux trois niveaux (48/73 articles), mais 7,2 s
        //   par bon en `low` contre 11,2 s sans vocabulaire et ~15 s en `high`,
        //   et 460 tokens de sortie contre ~1000. `low` est aussi le SEUL
        //   niveau dont les sommes de quantités sont conformes au papier sur
        //   les 7 bons, aux deux passages.
        //   ⚠️ `output_config` n'est envoyé qu'à claude-opus-5, et la raison
        //   n'est PAS que le repli le refuserait : vérifié par sonde,
        //   claude-opus-4-8 l'accepte sans erreur. La raison est qu'on n'a
        //   mesuré l'effet de `effort` que sur opus-5 (le repli n'a pas de
        //   raisonnement actif par défaut, l'effet y est au mieux nul). Le
        //   repli est le chemin d'urgence : on n'y ajoute pas un paramètre
        //   dont on n'a pas mesuré le comportement.
        const BC_SCAN_MODELS = ["claude-opus-5", "claude-opus-4-8"];
        const BC_SCAN_EFFORT_MODELS = { "claude-opus-5": "low" };
        let bcResponse = null;
        let bcLastError = null;
        for (const modelId of BC_SCAN_MODELS) {
          try {
            const bcBody = {
              model: modelId,
              max_tokens: 3000,
              messages: [{ role: "user", content: bcMessageContent }],
            };
            if (BC_SCAN_EFFORT_MODELS[modelId]) {
              bcBody.output_config = { effort: BC_SCAN_EFFORT_MODELS[modelId] };
            }
            bcResponse = await bcClient.messages.create(bcBody);
            break;
          } catch (e) {
            bcLastError = e;
            console.error("Erreur modèle scan-bc", modelId, e.message);
          }
        }
        if (!bcResponse) {
          return res.json({ success: false, scan_url, error: `Appel IA impossible : ${bcLastError ? bcLastError.message : "erreur inconnue"}` });
        }

        const bcAiText = (bcResponse.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
        const analysis = bcScan.parseAiJson(bcAiText);
        if (!analysis) {
          return res.json({ success: false, scan_url, error: "Analyse IA impossible - réponse non structurée", raw: bcAiText });
        }

        // 5) Rapprochement — ARTICLES UNIQUEMENT (catalogue actif + alias mémorisés).
        //
        // Les PARCELLES ne sont volontairement PAS rapprochées côté serveur : le
        // backend ne peut pas savoir quelle liste le front affiche au magasinier
        // (mode `useConsoSelector` -> `refForCampagne`, sinon `/api/parcelles`,
        // plus les groupes). Et le seul référentiel disponible ici,
        // `sb_parcelle_referentiel` (15 entrées), est bien un SOUS-ENSEMBLE des
        // 43 labels de `sql_mirror_pointage_meta/br_parcelle_sup` qui alimentent
        // `parcelles-campagne-list`, donc le <select> — ses 15 labels y figurent
        // tous, les deux listes ne sont PAS disjointes. Mais c'est un
        // sous-ensemble PARTIEL (15/43) et NON FILTRÉ PAR CAMPAGNE : rapprocher
        // contre lui, c'est (a) ne jamais pouvoir proposer les 28 autres
        // parcelles — dont « S3 - MARAVILLA MOTTE F1 », la plus utilisée des
        // bons — et (b) pouvoir proposer une parcelle hors campagne courante,
        // absente du select, donc rejetée. On renvoie donc `parcelle_lue` brut
        // et un statut `unmatched` franc ; le rapprochement se fait côté front,
        // là où la liste affichée est connue, via bcScan.matchParcelle.
        const flatItems = bcScan.flattenBcScan(analysis);
        // catalogueBc / aliasSnapBc sont déjà lus au §3 (ils servent aussi au
        // vocabulaire du prompt) — pas de seconde lecture Firestore ici.
        // Forme objet {article_nom, count} : le compteur d'usage est remonté au
        // front (article_alias_count) pour distinguer un alias confirmé N fois
        // d'un alias posé une seule fois par un magasinier — un alias reste une
        // saisie humaine, jamais une certitude.
        const aliasesBc = {};
        aliasSnapBc.forEach((d) => {
          const data = d.data() || {};
          if (data.article_nom) {
            aliasesBc[d.id] = { article_nom: data.article_nom, count: parseInt(data.count, 10) || 0 };
          }
        });
        const items = flatItems.map((it) => {
          const am = bcScan.matchArticle(it.article_lu, catalogueBc, aliasesBc);
          return {
            article_lu: it.article_lu,
            article: am.article,
            article_status: am.status,
            article_score: am.score,
            article_alias_count: am.aliasCount,
            // parcelle_lue = texte brut de l'en-tête manuscrit, indispensable au
            // rapprochement front. Les 3 champs suivants gardent la forme du
            // contrat (le front les consomme déjà) mais ne sont plus renseignés
            // ici : c'est le front qui rapproche, avec la liste qu'il affiche.
            parcelle_lue: it.parcelle_lue,
            parcelle: "",
            parcelle_status: "unmatched",
            parcelle_candidats: [],
            quantite: it.quantite,
            unite: it.unite_lue,
            pile: it.pile,
            // barre : la ligne est rayée sur le papier. Elle n'est PLUS filtrée
            // (dernier chemin de perte silencieuse) — le front la grise et
            // laisse l'utilisateur trancher, la détection de rature pouvant
            // se tromper. Champ additif, toujours booléen.
            barre: it.barre === true,
          };
        });

        return res.json({ success: true, scan_url, type: type || null, analysis, items });
      }


      if (action === "list-bc-scan-aliases") {
        const snap = await db_firestore.collection("bc_scan_aliases").get();
        const aliases = {};
        snap.forEach((d) => {
          const data = d.data() || {};
          if (data.article_nom) aliases[d.id] = data.article_nom;
        });
        return res.json({ success: true, aliases });
      }


      if (action === "save-bc-scan-alias" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body.
        const aliasRole = await resolveCallerRole(authUser);
        if (aliasRole !== "magasinier" && aliasRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }
        const { libelle_lu, article_nom, created_by } = req.body || {};
        if (!libelle_lu || !article_nom) {
          return res.status(400).json({ success: false, error: "Champs requis: libelle_lu, article_nom" });
        }
        const aliasId = bcScan.normalizeLabel(libelle_lu);
        if (!aliasId) return res.status(400).json({ success: false, error: "libelle_lu invalide" });

        const aliasRef = db_firestore.collection("bc_scan_aliases").doc(aliasId);
        const count = await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(aliasRef);
          const prev = snap.exists ? (snap.data() || {}) : {};
          const nextCount = (parseInt(prev.count, 10) || 0) + 1;
          tx.set(aliasRef, {
            libelle_lu: String(libelle_lu),
            article_nom: String(article_nom),
            count: nextCount,
            created_by: prev.created_by || created_by || {},
            updated_at: Date.now(),
          }, { merge: true });
          return nextCount;
        });
        return res.json({ success: true, id: aliasId, count });
      }


      // ---- Alias de PARCELLE (en-tête de pile manuscrit -> libellé BEE ONE) ----
      // Symétrique des alias d'article, avec UNE différence structurante : la
      // CAMPAGNE fait partie de la clé. Le secteur 9 portait « S9 - REYNA F5 »
      // (3 ha) en 2025-2026 et porte « F5- MYA S9 » + « F5 YAZMIN MT » en
      // 2026-2027 : un alias appris l'an dernier imputerait la consommation à une
      // parcelle qui n'existe plus. Cf. docs/spec-scan-apprentissage.md, risque R1.
      //
      // La valeur mémorisée est le LIBELLÉ BEE ONE, jamais le nom Smart Berry :
      // ce dernier n'est qu'un habillage d'affichage, et un renommage
      // invaliderait silencieusement tous les alias appris.

      if (action === "list-bc-scan-parcelle-aliases") {
        // Rôle résolu SERVEUR, comme save-bc-scan-parcelle-alias : ces alias
        // n'ont d'usage que dans la modale de scan, réservée au magasinier.
        const listParcAliasRole = await resolveCallerRole(authUser);
        if (listParcAliasRole !== "magasinier" && listParcAliasRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }
        const campagneAsked = String((req.query || {}).campagne || "").trim();
        // Sans campagne explicite, on ne renvoie RIEN : renvoyer « tous les alias »
        // reviendrait à laisser le front appliquer une correspondance d'une autre
        // campagne — exactement ce que la clé cherche à empêcher.
        if (!/^\d{4}-\d{4}$/.test(campagneAsked)) {
          return res.json({ success: true, campagne: "", aliases: {} });
        }
        const parcAliasSnap = await db_firestore.collection("bc_scan_parcelle_aliases")
          .where("campagne", "==", campagneAsked).get();
        const parcelleAliases = {};
        parcAliasSnap.forEach((d) => {
          const data = d.data() || {};
          if (data.normalise && data.parcelle) {
            parcelleAliases[data.normalise] = {
              parcelle: data.parcelle,
              count: parseInt(data.count, 10) || 0,
              campagne: data.campagne || campagneAsked,
            };
          }
        });
        return res.json({ success: true, campagne: campagneAsked, aliases: parcelleAliases });
      }


      if (action === "save-bc-scan-parcelle-alias" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body.
        const parcAliasRole = await resolveCallerRole(authUser);
        if (parcAliasRole !== "magasinier" && parcAliasRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }
        const { entete_lu, parcelle, campagne, created_by } = req.body || {};
        // En-tête illisible -> rien à apprendre (risque R6 : clé vide polluante).
        if (!entete_lu || !parcelle || !campagne) {
          return res.status(400).json({ success: false, error: "Champs requis: entete_lu, parcelle, campagne" });
        }
        const parcAliasId = bcScan.parcelleAliasDocId(campagne, entete_lu);
        if (!parcAliasId) {
          return res.status(400).json({ success: false, error: "entete_lu ou campagne invalide" });
        }
        const normalise = bcScan.normalizeLabel(entete_lu);

        const parcAliasRef = db_firestore.collection("bc_scan_parcelle_aliases").doc(parcAliasId);
        const parcCount = await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(parcAliasRef);
          const prev = snap.exists ? (snap.data() || {}) : {};
          // La DERNIÈRE décision humaine fait foi : si le magasinier choisit une
          // AUTRE parcelle pour le même en-tête, on écrase et le compteur repart
          // à 1 (module pur bcScan.nextParcelleAliasCount, testé unitairement).
          const memeParcelle = String(prev.parcelle || "") === String(parcelle);
          const nextCount = bcScan.nextParcelleAliasCount(prev, parcelle);
          tx.set(parcAliasRef, {
            entete_lu: String(entete_lu),
            normalise,
            campagne: String(campagne),
            parcelle: String(parcelle),
            count: nextCount,
            created_by: memeParcelle ? (prev.created_by || created_by || {}) : (created_by || {}),
            updated_by: created_by || {},
            updated_at: Date.now(),
          }, { merge: true });
          return nextCount;
        });
        return res.json({ success: true, id: parcAliasId, count: parcCount });
      }


      // ---- JOURNAL DE PRÉCISION DU SCAN (spec §4.4, lot C) --------------------
      // Un document par ligne ENREGISTRÉE — pas seulement par ligne corrigée.
      // Une proposition conservée est une CONFIRMATION : c'est le dénominateur,
      // sans lui aucun taux n'est calculable. Le journal sert à régler les
      // seuils (SIMILARITY_THRESHOLD / INCLUSION_THRESHOLD) sur des faits, et
      // surtout à faire apparaître les faux positifs avérés : une proposition
      // sortie en `exact` puis corrigée par le magasinier.
      //
      // ⚠️ Cette action est de l'OBSERVATION, jamais du métier. Le front
      // l'appelle APRÈS un `create-bc` réussi, en best effort : un échec ici ne
      // doit jamais faire échouer l'enregistrement du bon. Le contrat de
      // `create-bc` reste inchangé (purement additif).
      if (action === "save-bc-scan-journal" && req.method === "POST") {
        // Rôle résolu SERVEUR, jamais depuis le body — même garde que les alias.
        const journalRole = await resolveCallerRole(authUser);
        if (journalRole !== "magasinier" && journalRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }
        const { date: journalDate, bon_numero: journalBon, lignes: journalLignes } = req.body || {};
        // `corrige_par` est résolu SERVEUR (token + profil), jamais repris du
        // body : c'est une donnée d'audit, elle ne se déclare pas.
        const journalBuilt = bcScanJournal.buildJournalDocs({
          date: journalDate,
          bon_numero: journalBon,
          lignes: journalLignes,
          corrige_par: {
            uid: (authUser && authUser.uid) || "",
            profileId: journalRole,
            name: (authUser && (authUser.name || authUser.email)) || "",
          },
        });
        if (!journalBuilt.ok) {
          return res.status(400).json({ success: false, error: journalBuilt.error });
        }
        // Un bon fait une quinzaine de lignes : un seul batch suffit très
        // largement (plafond du module = 200, limite Firestore = 500).
        const journalBatch = db_firestore.batch();
        journalBuilt.docs.forEach((doc) => {
          journalBatch.set(db_firestore.collection("bc_scan_corrections").doc(), doc);
        });
        await journalBatch.commit();
        return res.json({
          success: true,
          campagne: journalBuilt.campagne,
          enregistrees: journalBuilt.docs.length,
          ignorees: journalBuilt.ignorees,
        });
      }

  return NOT_HANDLED;
};
