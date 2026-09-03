/* Actions 5/6 de stockManagement — corps repris VERBATIM.
   Le contexte du handler (req, res, action, helpers) arrive par `ctx` ; la
   destructuration ci-dessous recree exactement les liaisons d'origine, si bien
   que les corps n'ont pas ete touches. */
'use strict';
const { NOT_HANDLED } = require("./_dispatch");
const { admin, bucket, db_firestore, demandeCreationArticle, dispatchNotification, resolveCallerRole, bdcReceptionGuard, stockCaneva, stockMovementGuard, receptionBdc, isImpactApplied, checkStockAvailability, sliceArticleHistory, identiteArticle, getArticleHistoryIndex, getIdentiteArticleIndex, resoudreLignesStock, enregistrerDemandesCreation, getNextNumber } = require("./magasin.stock.deps");

module.exports = async function stockActions5(ctx) {
  const { req, res, action, adminSecret, authUser, updateStockBalance, applyStockImpact, reverseStockImpact, getChefProfileForFerme, resolveRequesterIdentity } = ctx;



      // ========== SCAN FICHE IRRIGATION (AI-powered irrigation sheet scanning) ==========

      if (action === "scan-irrigation-sheet" && req.method === "POST") {
        const { scan_base64, filename } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.jpg").split(".").pop().toLowerCase() || "jpg";
        const ts = Date.now();
        const storagePath = `scans/irrigation/${ts}_${filename || "scan." + ext}`;
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
          { type: "text", text: `Tu es un assistant spécialisé dans la lecture de fiches d'irrigation manuscrites de Berry Good Farms (culture de framboise et myrtille au Maroc).

La fiche contient un tableau avec des lectures d'irrigation relevées par les stationnaires.
L'en-tête indique généralement la ferme (F1 ou F5) et la parcelle (ex: CORINA MYRTILLE S8).
Le tableau contient plusieurs lignes, chaque ligne correspondant à un relevé à une date/heure donnée.

Pour chaque ligne, on trouve :
- Heure de début
- Parcelle / secteur
- Pour chaque POINT d'irrigation (jusqu'à 4 points) : EC (conductivité électrique en mS/cm), pH, Volume (en litres)
- Pour chaque point de DRAINAGE correspondant : EC, pH, Volume (en % ou litres)

Les dates peuvent être inscrites en ligne ou en en-tête de section (ex: "14/03/2026" ou "14/ 03/ 2026").
L'année est TOUJOURS 2025 ou 2026 (saison 2025-2026).

Extrais TOUTES les lignes du tableau. Retourne un JSON strict :
{
  "ferme": "F1" ou "F5",
  "parcelle": "nom exact de la parcelle tel qu'inscrit sur la fiche",
  "lectures": [
    {
      "date": "YYYY-MM-DD",
      "heure": "HH:MM",
      "duree": 0,
      "points": [
        { "ec": 1.8, "ph": 6.2, "volume": 12.5 },
        { "ec": 1.9, "ph": 6.1, "volume": 11.8 }
      ],
      "drainage": [
        { "ec": 2.5, "ph": 5.8, "volume": 22 },
        { "ec": 2.6, "ph": 5.7, "volume": 25 }
      ]
    }
  ]
}

IMPORTANT:
- Retourne UNIQUEMENT le JSON, sans texte avant ou après
- Lis CHAQUE ligne du tableau, même si l'écriture est difficile à lire
- Les valeurs EC sont généralement entre 0.5 et 5.0 mS/cm
- Les valeurs pH sont généralement entre 4.0 et 8.0
- Si la durée n'est pas indiquée, mets 0
- Si une valeur n'est pas lisible, mets null
- Fais attention aux séparateurs décimaux : virgule ou point
- Les dates en en-tête s'appliquent à toutes les lignes en dessous jusqu'à la prochaine date` }
        ];

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 4000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-irrigation", modelId, e.message);
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


      // ========== ANALYSE IRRIGATION (AI-powered agronomic analysis) ==========

      if (action === "analyse-irrigation" && req.method === "POST") {
        const { readings, ferme, parcelle } = req.body;
        if (!readings || !readings.length) return res.status(400).json({ success: false, error: "readings requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.json({ success: true, analyse: "⚠️ Clé API Anthropic non configurée." });

        // Build data summary for Claude
        const dataLines = readings.map(r => {
          const ptsEc = (r.points || []).filter(p => p.ec > 0).map(p => p.ec);
          const ptsPh = (r.points || []).filter(p => p.ph > 0).map(p => p.ph);
          const ptsVol = (r.points || []).filter(p => p.volume > 0).map(p => p.volume);
          const drEc = (r.drainage || []).filter(d => d.ec > 0).map(d => d.ec);
          const drPh = (r.drainage || []).filter(d => d.ph > 0).map(d => d.ph);
          const drVol = (r.drainage || []).filter(d => d.volume > 0).map(d => d.volume);
          const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 'N/A';
          return `${r.date} ${r.heure || ''} | Parcelle: ${r.parcelleLabel || r.parcelle} | Durée: ${r.duree || 0}min | Apport EC=${avg(ptsEc)} pH=${avg(ptsPh)} Vol=${avg(ptsVol)}L | Drainage EC=${avg(drEc)} pH=${avg(drPh)} Vol=${avg(drVol)}%`;
        }).join('\n');

        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });

        const prompt = `Tu es un ingénieur agronome spécialisé dans l'irrigation des cultures de framboise et myrtille sous serre au Maroc (Berry Good Farms).

Voici les données d'irrigation des derniers jours pour la ferme ${ferme || 'N/A'}${parcelle ? ', parcelle ' + parcelle : ''} :

${dataLines}

Analyse ces données comme le ferait un expert en irrigation et fournis :

## 1. Diagnostic EC (Conductivité Électrique)
- EC apport vs EC drainage : le ratio est-il dans la norme (drainage/apport < 1.5) ?
- Tendance : l'EC dérive-t-elle ? Accumulation saline ?
- Recommandation : faut-il ajuster la concentration de la solution nutritive ?

## 2. Diagnostic pH
- Le pH est-il dans la plage optimale (5.5-6.5 pour framboise, 4.5-5.5 pour myrtille) ?
- Écart pH apport vs drainage : y a-t-il un problème de tampon du substrat ?
- Recommandation : ajustement acide/base nécessaire ?

## 3. Drainage
- Le % de drainage est-il dans la cible (20-30%) ?
- Est-il régulier ou très variable ?
- Recommandation : ajuster le volume par irrigation ?

## 4. Fréquence & Volume
- Le nombre d'irrigations par jour est-il adapté au stade et à la saison ?
- Le volume par cycle est-il cohérent ?
- Recommandation : modifier la fréquence ou le volume ?

## 5. Actions Prioritaires (3 max)
Liste les 3 actions les plus urgentes à prendre, classées par priorité.

Réponds en français, de manière concise et actionnable. Utilise des émojis pour les niveaux d'alerte :
🟢 = OK, 🟡 = À surveiller, 🔴 = Action urgente`;

        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: prompt }] });
            break;
          } catch (e) {
            console.error("Erreur modèle analyse-irrigation", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const analyse = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        return res.json({ success: true, analyse });
      }


      // `movementNeedsMultiValidation(type)` vivait ici. Supprimée : elle
      // n'était appelée nulle part, et affirmait que les réceptions restent en
      // attente de validation Achats — exactement l'inverse de ce que fait
      // désormais le code. Un helper mort qui contredit le comportement réel est
      // pire qu'absent : il se lit comme une règle.

      // --- UPLOAD SCAN for stock movements ---
      if (action === "upload-scan" && req.method === "POST") {
        const { file_base64, filename, contentType } = req.body || {};
        if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
        const buffer = Buffer.from(file_base64.replace(/^data:[^;]+;base64,/, ""), "base64");
        const ext = (filename || "scan.jpg").split(".").pop() || "jpg";
        const storagePath = `stock_scans/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType: contentType || `image/${ext}` } });
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        return res.json({ success: true, url: publicUrl });
      }


      // --- IMPORT CANEVA STOCK (workflow Achats → validation Finance) ---
      if (action === "import-caneva-stock" && req.method === "POST") {
        const XLSX = require("xlsx");
        const { mode, file_base64, request_id, motif, requested_by, reviewed_by } = req.body || {};
        const IMPORT_SOURCE = stockCaneva.IMPORT_SOURCE;
        const COL = "stock_caneva_imports";
        const ROLE_CONTROLE = ["finance", "dg"];
        const BATCH = 450;

        const actor = mode === "approve" || mode === "reject" || mode === "restore"
          ? (reviewed_by || {})
          : (requested_by || {});

        // ---- helpers ----
        async function commitOps(ops) {
          for (let i = 0; i < ops.length; i += BATCH) {
            const batch = db_firestore.batch();
            for (const op of ops.slice(i, i + BATCH)) {
              if (op.type === "set") batch.set(op.ref, op.data, op.options || {});
              else if (op.type === "delete") batch.delete(op.ref);
            }
            await batch.commit();
          }
        }
        function decodeB64(b64) {
          return Buffer.from(String(b64 || "").replace(/^data:[^;]+;base64,/, ""), "base64");
        }
        // Load all CANEVA movements once (for shrink count + per-day diff)
        async function loadCaneva() {
          const snap = await db_firestore.collection("stock_movements").where("import_source", "==", IMPORT_SOURCE).get();
          return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        // Parse + guard + per-day diff against existing CANEVA ledger
        async function analyze(buffer) {
          const plan = stockCaneva.parseWorkbook(buffer, XLSX);
          const allCaneva = await loadCaneva();
          const dates = new Set(plan.movements.map((m) => m.date).filter(Boolean));
          const existing = allCaneva.filter((m) => dates.has(m.date));
          const guard = stockCaneva.evaluateGuard(plan, { currentMovementCount: allCaneva.length });
          const diff = stockCaneva.computeDayDiff(plan, existing);
          const summary = stockCaneva.buildDrySummary(plan, guard, diff);
          return { plan, guard, diff, summary, allCaneva };
        }
        // Build a stored stock_movement doc from a parsed plan movement
        function buildMovementDoc(m) {
          const needsMulti = m.type === "reception" || m.type === "sortie";
          const validations = { magasinier: { by: "import_caneva", name: "Import CANEVA", at: Date.now() } };
          if (needsMulti) {
            validations.achats = { by: "import_caneva", name: "Import CANEVA", at: Date.now() };
            validations.chef = { by: "import_caneva", name: "Import CANEVA", at: Date.now() };
          }
          return {
            numero: m.numero, type: m.type, date: m.date,
            lieu_source: m.lieu_source || null, lieu_destination: m.lieu_destination || null,
            ferme: m.ferme || "", items: m.items || [],
            ref_bl_fournisseur: m.ref_bl_fournisseur || "", fournisseur_nom: m.fournisseur_nom || null,
            reception_libre: !!m.reception_libre, reception_libre_motif: m.reception_libre_motif || "",
            ref_bon_physique: m.ref_bon_physique || "", sortie_type: m.sortie_type || null,
            numero_source: m.numero_source || "", bdc_id: null, bl_id: null, scan_url: null,
            status: needsMulti ? "valide_chef" : "valide_mag",
            validations, rejection: null,
            import_source: IMPORT_SOURCE,
            created_by: { userId: "import_caneva", name: "Import CANEVA" },
            imported_by: { userId: actor.userId || "", name: actor.name || "", profileId: actor.profileId || "" },
            created_at: Date.now(), updated_at: Date.now(),
          };
        }
        // Rebuild ALL stock_balances from inventory baseline + full movement ledger
        async function rebuildBalances(balancesInit) {
          // ⚠️ GÉNÉRATION ET PURGE PARTAGENT LA MÊME RÈGLE DE CLÉ.
          // Ce helper portait sa PROPRE copie de la formule (`keyOf`) et
          // rangeait les soldes sous le LIBELLÉ des mouvements, tandis que la
          // purge supprimait « tout ce qui n'a pas été régénéré ». Un import
          // effaçait donc les soldes rangés sous la référence de la fiche, que
          // la saisie courante recréait aussitôt à côté : c'est l'aggravant qui
          // faisait remonter le compte de fragments après chaque import.
          // Désormais la clé vient d'`identifiantSoldeCanonique`, alimentée par
          // l'identité RÉSOLUE, et la purge est dérivée des clés réellement
          // générées (`docsAPurger`) — la divergence n'est plus exprimable.
          //
          // Les 4 516 mouvements gardent leur libellé (décision d'Omar) : c'est
          // ici, à la lecture, qu'il devient une identité.
          const identiteIndex = await getIdentiteArticleIndex(db_firestore, { force: true });
          /** @type {Array<Object>} */
          const deltas = [];
          const add = (lt, li, ref, nom, unite, delta) => {
            deltas.push({ lieu_type: lt, lieu_id: li, article_ref: ref, article_nom: nom, unite, delta });
          };
          for (const b of balancesInit) add(b.lieu_type, b.lieu_id, b.article_ref, b.article_nom, b.unite, b.balance);
          const allMovSnap = await db_firestore.collection("stock_movements").get();
          for (const doc of allMovSnap.docs) {
            const mData = doc.data();
            // Ne sommer que les mouvements dont l'impact stock est posé en live
            // (status 'valide_chef', ni soft-deleted ni rejete). Exclut les
            // réceptions non encore validées Achats (en_attente_achats / valide_mag)
            // qui sinon gonfleraient les soldes reconstruits. Cf. lib/stock/movementImpact.
            if (!isImpactApplied(mData)) continue;
            for (const d of stockCaneva.movementDelta(mData)) add(d.lieu_type, d.lieu_id, d.article_ref, d.article_nom, d.unite, d.delta);
          }
          // Une SEULE agrégation, une SEULE règle de clé (identité résolue).
          const { soldes, non_resolus } = identiteArticle.agregerSoldes(deltas, identiteIndex);
          if (non_resolus.length) {
            // Repli assumé (cf. identiteArticle.agregerSoldes) : un libellé
            // historique orphelin garde sa clé brute et survit donc à la purge.
            // Tracé, parce qu'un solde qu'aucune fiche ne réclame est du stock
            // que plus personne ne voit.
            console.warn("rebuildBalances : libellés sans fiche au catalogue —", non_resolus.join(", "));
          }
          // Write computed balances; delete stale ones absent from the rebuild
          const existingBalSnap = await db_firestore.collection("stock_balances").get();
          const ops = [];
          for (const [k, v] of soldes) {
            ops.push({ type: "set", ref: db_firestore.collection("stock_balances").doc(k), data: { ...v, updated_at: Date.now() } });
          }
          // La purge est DÉRIVÉE des clés générées, jamais recalculée : un
          // import ne peut plus supprimer un solde qu'il sait régénérer.
          const aPurger = new Set(identiteArticle.docsAPurger(soldes, existingBalSnap.docs.map((d) => d.id)));
          for (const doc of existingBalSnap.docs) {
            if (aPurger.has(doc.id)) ops.push({ type: "delete", ref: doc.ref });
          }
          await commitOps(ops);
        }
        // Execute the per-day import for the impacted dates
        async function executeImport(plan, diff, allCaneva) {
          const impacted = stockCaneva.impactedDates(diff);
          const ops = [];
          // 1. delete impacted-day CANEVA movements (strictly import_source + date)
          for (const m of allCaneva) {
            if (impacted.has(m.date)) ops.push({ type: "delete", ref: db_firestore.collection("stock_movements").doc(m.id) });
          }
          // 2. upsert articles from the workbook
          for (const art of plan.articlesToCreate) {
            ops.push({
              type: "set",
              ref: db_firestore.collection("articles_catalog").doc(art.reference),
              data: {
                reference: art.reference, nom: art.nom, unite: art.unite,
                categorie: art.categorie, type: "Stockable", active: true,
                import_source: IMPORT_SOURCE, updated_at: Date.now(),
              },
              options: { merge: true },
            });
          }
          // 3. create movements for impacted dates
          for (const m of plan.movements) {
            if (impacted.has(m.date)) ops.push({ type: "set", ref: db_firestore.collection("stock_movements").doc(), data: buildMovementDoc(m) });
          }
          await commitOps(ops);
          // 4. replace CANEVA cost docs (derived wholesale from the workbook)
          const costSnap = await db_firestore.collection("consumption_costs_by_variety").where("import_source", "==", IMPORT_SOURCE).get();
          const costOps = costSnap.docs.map((d) => ({ type: "delete", ref: d.ref }));
          for (const [code, agg] of Object.entries(plan.costsByVariety)) {
            costOps.push({ type: "set", ref: db_firestore.collection("consumption_costs_by_variety").doc(code), data: { ...agg, import_source: IMPORT_SOURCE, updated_at: Date.now() } });
          }
          await commitOps(costOps);
          // 5. rebuild balances from full ledger
          await rebuildBalances(plan.balancesInit);
          return { impacted_dates: [...impacted].sort() };
        }
        // Archive uploaded workbook to Storage, keep only the last 7 files
        async function storeFile(buffer) {
          const path = `stock_caneva_imports/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.xlsx`;
          await bucket.file(path).save(buffer, { metadata: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
          return path;
        }
        async function pruneArchive() {
          const snap = await db_firestore.collection(COL).where("file_pruned", "==", false).get();
          const withFile = snap.docs
            .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
            .filter((d) => d.file_path)
            .sort((a, b) => (b.requested_at || 0) - (a.requested_at || 0));
          for (const d of withFile.slice(7)) {
            try { await bucket.file(d.file_path).delete(); } catch (_) {}
            await d.ref.update({ file_pruned: true });
          }
        }

        try {
          // ===== PREVIEW (achats) — aucune écriture =====
          if (mode === "preview") {
            if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
            const { summary } = await analyze(decodeB64(file_base64));
            if (summary.guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: summary.guard.reasons, summary });
            return res.json({ success: true, summary });
          }

          // ===== APPLY (achats) — uniquement si aucun jour modifié =====
          if (mode === "apply") {
            if (actor.profileId !== "achats") return res.status(403).json({ success: false, error: "Réservé au rôle Achats" });
            if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
            const buffer = decodeB64(file_base64);
            const { plan, guard, diff, summary, allCaneva } = await analyze(buffer);
            if (guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: guard.reasons, summary });
            if (diff.jours_modifies.length > 0) return res.json({ success: false, error: "Validation Finance requise (jours déjà importés)", summary });
            const exec = await executeImport(plan, diff, allCaneva);
            const file_path = await storeFile(buffer);
            const docRef = await db_firestore.collection(COL).add({
              status: "importe", file_path, file_pruned: false, filename: req.body.filename || "canevas.xlsx",
              summary, jours_nouveaux: diff.jours_nouveaux, jours_modifies: diff.jours_modifies,
              prior_import_existed: allCaneva.length > 0, requested_by: actor, requested_at: Date.now(),
              reviewed_by: null, reviewed_at: null, motif_rejet: null,
              history: [{ action: "apply", by: actor, at: Date.now() }],
            });
            await pruneArchive();
            return res.json({ success: true, request_id: docRef.id, status: "importe", summary, ...exec });
          }

          // ===== REQUEST (achats) — jours modifiés → file d'attente Finance =====
          if (mode === "request") {
            if (actor.profileId !== "achats") return res.status(403).json({ success: false, error: "Réservé au rôle Achats" });
            if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
            const buffer = decodeB64(file_base64);
            const { diff, summary, allCaneva } = await analyze(buffer);
            if (summary.guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: summary.guard.reasons, summary });
            if (diff.jours_modifies.length === 0) return res.json({ success: false, error: "Aucun jour modifié — utilisez l'import direct", summary });
            const file_path = await storeFile(buffer);
            const docRef = await db_firestore.collection(COL).add({
              status: "en_attente_finance", file_path, file_pruned: false, filename: req.body.filename || "canevas.xlsx",
              summary, jours_nouveaux: diff.jours_nouveaux, jours_modifies: diff.jours_modifies,
              prior_import_existed: allCaneva.length > 0, requested_by: actor, requested_at: Date.now(),
              reviewed_by: null, reviewed_at: null, motif_rejet: null,
              history: [{ action: "request", by: actor, at: Date.now() }],
            });
            await pruneArchive();
            await dispatchNotification({
              type: "caneva_import_request", profiles: ["finance"], channels: ["in_app"],
              data: { message: `Import canevas Stock à valider — ${diff.jours_modifies.length} jour(s) seront remplacés (demandé par ${actor.name || "Achats"})`, severity: "warning" },
              relatedDoc: `${COL}/${docRef.id}`,
            });
            return res.json({ success: true, request_id: docRef.id, status: "en_attente_finance", summary });
          }

          // ===== APPROVE / RESTORE (finance/dg) =====
          if (mode === "approve" || mode === "restore") {
            if (!ROLE_CONTROLE.includes(actor.profileId)) return res.status(403).json({ success: false, error: "Réservé à Finance/DG" });
            if (!request_id) return res.status(400).json({ success: false, error: "request_id requis" });
            const docRef = db_firestore.collection(COL).doc(request_id);
            const docSnap = await docRef.get();
            if (!docSnap.exists) return res.status(404).json({ success: false, error: "Demande introuvable" });
            const reqDoc = docSnap.data();
            if (mode === "approve" && reqDoc.status !== "en_attente_finance") return res.status(400).json({ success: false, error: `Statut ${reqDoc.status} non approuvable` });
            if (reqDoc.file_pruned || !reqDoc.file_path) return res.status(400).json({ success: false, error: "Fichier archivé indisponible (élagué)" });
            const [buffer] = await bucket.file(reqDoc.file_path).download();
            const { plan, guard, diff, summary, allCaneva } = await analyze(buffer);
            if (guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: guard.reasons, summary });
            const exec = await executeImport(plan, diff, allCaneva);
            const history = (reqDoc.history || []).concat([{ action: mode, by: actor, at: Date.now() }]);
            await docRef.update({ status: "importe", reviewed_by: actor, reviewed_at: Date.now(), summary, history });
            await dispatchNotification({
              type: "caneva_import_approved", profiles: ["achats"], channels: ["in_app"],
              data: { message: `Import canevas Stock ${mode === "restore" ? "restauré" : "approuvé"} par ${actor.name || "Finance"}`, severity: "info" },
              relatedDoc: `${COL}/${request_id}`,
            });
            return res.json({ success: true, status: "importe", summary, ...exec });
          }

          // ===== REJECT (finance/dg) =====
          if (mode === "reject") {
            if (!ROLE_CONTROLE.includes(actor.profileId)) return res.status(403).json({ success: false, error: "Réservé à Finance/DG" });
            if (!request_id) return res.status(400).json({ success: false, error: "request_id requis" });
            const docRef = db_firestore.collection(COL).doc(request_id);
            const docSnap = await docRef.get();
            if (!docSnap.exists) return res.status(404).json({ success: false, error: "Demande introuvable" });
            const reqDoc = docSnap.data();
            if (reqDoc.status !== "en_attente_finance") return res.status(400).json({ success: false, error: `Statut ${reqDoc.status} non rejetable` });
            const history = (reqDoc.history || []).concat([{ action: "reject", by: actor, at: Date.now(), motif: motif || "" }]);
            await docRef.update({ status: "rejete", reviewed_by: actor, reviewed_at: Date.now(), motif_rejet: motif || "", history });
            await dispatchNotification({
              type: "caneva_import_rejected", profiles: ["achats"], channels: ["in_app"],
              data: { message: `Import canevas Stock rejeté par ${actor.name || "Finance"}${motif ? " : " + motif : ""}`, severity: "warning" },
              relatedDoc: `${COL}/${request_id}`,
            });
            return res.json({ success: true, status: "rejete" });
          }

          // ===== LIST (achats/finance) =====
          if (mode === "list") {
            const snap = await db_firestore.collection(COL).orderBy("requested_at", "desc").limit(50).get();
            const requests = snap.docs.map((d) => {
              const x = d.data();
              return {
                id: d.id, status: x.status, filename: x.filename, file_pruned: !!x.file_pruned,
                requested_by: x.requested_by, requested_at: x.requested_at,
                reviewed_by: x.reviewed_by, reviewed_at: x.reviewed_at, motif_rejet: x.motif_rejet,
                jours_nouveaux: x.jours_nouveaux || [], jours_modifies: x.jours_modifies || [],
                summary: x.summary || null,
              };
            });
            const pending = requests.filter((r) => r.status === "en_attente_finance").length;
            return res.json({ success: true, requests, pending });
          }

          return res.status(400).json({ success: false, error: "mode invalide" });
        } catch (e) {
          console.error("import-caneva-stock error:", e);
          return res.status(500).json({ success: false, error: e.message });
        }
      }


      // --- CREATE MOVEMENT ---
      if (action === "create-movement" && req.method === "POST") {
        const { type, date, lieu_source, lieu_destination, ferme, items, ref_bl_fournisseur,
          bdc_id, bl_id, ref_bon_physique,
          sortie_type, scan_url, fournisseur_nom, beneficiaire, created_by,
          motif_rebut, justificatif_url } = req.body;

        if (!type || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: type, items[]" });
        }
        const validTypes = ["reception", "transfert", "consommation", "sortie"];
        if (!validTypes.includes(type)) {
          return res.status(400).json({ success: false, error: "Type invalide. Valeurs: " + validTypes.join(", ") });
        }
        if (type === "sortie" && !["retour_fournisseur", "pret", "rebut"].includes(sortie_type)) {
          return res.status(400).json({ success: false, error: "sortie_type requis: retour_fournisseur, pret, rebut" });
        }
        // La réception libre est SUPPRIMÉE : toute réception doit être rattachée à
        // un bon de commande, comme create-bl l'exige déjà. Sans BDC il n'existe
        // aucune source de prix, donc aucune valorisation possible — la
        // marchandise entrait en stock sans jamais compter dans les coûts.
        //
        // Mesure production avant fermeture : 2 réceptions sans bdc_id créées dans
        // l'application (BR-2026-0003 et BR-2026-0006, du 6 au 11 juin 2026),
        // aucune depuis, contre 64 via bon de commande jusqu'au 24 août.
        //
        // Message actionnable, pas un 400 sec : l'écran vers lequel aller est nommé.
        if (type === "reception" && !bdc_id) {
          return res.status(400).json({
            success: false,
            error: "Une réception doit être rattachée à un bon de commande. Utilisez l'onglet « BDC à réceptionner » pour saisir la livraison à partir du BDC concerné.",
            code: "bdc_requis",
          });
        }

        // Identité créateur : on force userId = uid du TOKEN (anti-spoof), en
        // conservant profileId/name fournis par le body. Le contrôle créateur du
        // guard (stockMovementGuard) s'appuie sur cet uid pour les éditions/suppressions.
        const movCreatedBy = { ...(created_by || {}), userId: authUser.uid };

        const prefixMap = { reception: "BR", transfert: "BT", consommation: "BCS", sortie: "BS" };
        const numType = "stock_" + type;
        const numero = await getNextNumber(numType, prefixMap[type]);

        // ⚠️ GARDE-FOU : ce mapping ne conserve QUE article/quantité/unité. Toute
        // `parcelle` (ou `groupe_id`) envoyée par item est IGNORÉE ici, sans
        // erreur. La SEULE voie d'entrée d'une parcelle dans les données de
        // stock est `create-bc` (qui éclate les groupes au prorata des Ha).
        // Une évolution Réception/Sortie qui enverrait une parcelle par item se
        // croirait fonctionnelle en silence : la propager explicitement ici
        // AVANT de s'appuyer dessus en aval.
        const movItemsSaisis = items.map((it) => ({
          article_ref: it.article_ref || it.article || "",
          article_nom: it.article_nom || it.article || "",
          quantite: parseFloat(it.quantite) || 0,
          // Aucune unité fabriquée — MÊME règle que create-bl. Inventer "kg" ici
          // faisait pire qu'une absence : le module comparait alors deux unités
          // CONNUES et différentes (BDC en L contre "kg" inventé) et refusait le
          // prix pour divergence. Les deux chemins de création d'une réception
          // rendaient des résultats différents pour la MÊME livraison — la
          // divergence silencieuse que ce lot existe pour rendre impossible.
          unite: it.unite || "",
        }));

        // --- IDENTITÉ D'ARTICLE (lib/stock/identiteArticle) ----------------
        // Le front envoie un LIBELLÉ dans `article_ref` (transfert et sortie le
        // remplissent explicitement avec le nom : le champ « référence » existe
        // et il est faux). On le RÉSOUT ici, une fois, vers le docId de la
        // fiche active — avant la garde de stock, avant la valorisation, avant
        // toute écriture.
        //
        // FAIL-CLOSED (décision d'Omar) : un article inconnu ou ambigu fait
        // échouer le bon, en le nommant. Rien n'entre en stock sous une
        // identité inventée.
        const movResolution = await resoudreLignesStock(db_firestore, movItemsSaisis);
        if (!movResolution.ok) {
          // DÉCISION D'OMAR : « on demande au magasinier de demander la
          // création de l'article et de la soumettre au DG ». Le refus n'est
          // donc pas une impasse — il OUVRE la demande lui-même. Ces écrans
          // (transfert, sortie) n'ont pas le bouton « Créer cet article », et
          // `public/app.jsx` est gelé : la sortie ne peut être que serveur.
          const movDemandes = await enregistrerDemandesCreation(
            db_firestore,
            movResolution.refus.details,
            { uid: authUser.uid, profileId: (created_by || {}).profileId || "", name: (created_by || {}).name || "" },
            { origine: "create-movement", type, numero: "" }
          );
          return res.status(400).json({
            success: false,
            // Le message part tel quel dans l'`alert()` existant du front :
            // aucune modification de `public/app.jsx` n'est nécessaire.
            error: demandeCreationArticle.messageRefus(movResolution.refus.details, movDemandes),
            code: movResolution.refus.code,
            demandes_creation: movDemandes,
          });
        }
        // `article_nom` conserve le libellé saisi : la valorisation
        // (prixLigne.valoriserLignes) le lit en priorité, elle voit donc
        // toujours le même article qu'avant ce lot.
        const movItems = movResolution.lignes;

        if (type === "reception") {
          const negativeItem = movItems.find((it) => it.quantite < 0);
          if (negativeItem) {
            return res.status(400).json({ success: false, error: `Quantité reçue négative invalide pour ${negativeItem.article_nom || negativeItem.article_ref}` });
          }
        }

        // --- Contrôle stock avant sortie/transfert ---
        // Bloque la création si le stock disponible au lieu de départ est
        // insuffisant. Réception/consommation hors périmètre (helper exempté).
        // Note: lecture des soldes puis applyStockImpact dans des transactions
        // distinctes → fenêtre de course théorique sous forte concurrence,
        // acceptable ici (peu de magasiniers simultanés).
        // Le helper ne garde que sortie/transfert ; on ne lit les soldes que
        // pour ces types ET quand un lieu de départ est défini.
        const STOCK_GUARDED_TYPES = ["sortie", "transfert"];
        if (STOCK_GUARDED_TYPES.includes(type) && lieu_source && lieu_source.id) {
          //
          // ⚠️ POINT LE PLUS VICIEUX DU CHANTIER. Cette garde reconstruisait
          // l'identifiant du solde AVEC SA PROPRE COPIE de la formule, à partir
          // du libellé. Si elle lit sous une clé que l'écriture n'emploie plus,
          // elle interroge un seau VIDE : elle laisse alors sortir du stock qui
          // n'existe pas, sans la moindre erreur. La clé de LECTURE est donc
          // dérivée de la MÊME fonction que la clé d'ÉCRITURE
          // (`identifiantSoldeCanonique`), à partir des lignes DÉJÀ RÉSOLUES.
          const gardeCles = identiteArticle.identifiantsGardeStock(lieu_source, movItems);
          const availableByRef = {};
          const balSnaps = await Promise.all(
            gardeCles.map((c) => db_firestore.collection("stock_balances").doc(c.balanceId).get())
          );
          gardeCles.forEach((c, idx) => {
            const snap = balSnaps[idx];
            availableByRef[c.ficheId] = snap.exists ? (snap.data().balance || 0) : 0;
          });
          const guardResult = checkStockAvailability({ type, items: movItems }, availableByRef);
          if (!guardResult.allowed) {
            return res.status(400).json({ success: false, error: guardResult.error, code: "insufficient_stock" });
          }
        }

        const singleValidation = !!req.body.single_validation;
        // TOUS les types sont auto-validés, impact stock immédiat à la création.
        //
        // Les réceptions le sont depuis la suppression de l'étape Achats : ce
        // chemin les créait en `en_attente_achats`, c'est-à-dire hors stock tant
        // qu'un profil Achats ne les validait pas — ce que plus personne ne
        // faisait. C'était la même impasse que create-bl, par une autre porte.
        const isReception = type === "reception";

        // Valorisation : MÊME décision que create-bl, même module pur. Une seule
        // règle de prix dans le dépôt, aucune divergence silencieuse possible
        // entre les deux chemins de création d'une réception.
        let receptionItems = movItems;
        let receptionValorisation = null;
        if (isReception) {
          // Source de prix = le BDC lié, s'il y en a un. Une réception sans BDC
          // n'a aucune source : ses lignes entrent en stock NON valorisées, avec
          // leur motif. Jamais un zéro par défaut.
          let bdcSource = null;
          if (bdc_id) {
            const bdcSnapForPrix = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
            if (bdcSnapForPrix.exists) bdcSource = bdcSnapForPrix.data();
          }
          const valoMov = receptionBdc.valoriserItemsReception(movItems, bdcSource);
          receptionItems = valoMov.items;
          receptionValorisation = valoMov.resume;
        }
        // Statut de création d'une réception : la constante testée du module,
        // jamais une chaîne en dur ici.
        const initialStatus = isReception ? receptionBdc.STATUT_RECEPTION_A_LA_CREATION : "valide_chef";

        const movData = {
          numero, type,
          date: date || new Date().toISOString().split("T")[0],
          lieu_source: lieu_source || null,
          lieu_destination: lieu_destination || null,
          ferme: ferme || "",
          items: receptionItems,
          ref_bl_fournisseur: ref_bl_fournisseur || "",
          bdc_id: bdc_id || null,
          bl_id: bl_id || null,
          // `reception_libre` / `reception_libre_motif` ne sont plus écrits : la
          // réception libre est supprimée. Les documents existants les conservent
          // (les effacer serait une migration de données, et ils n'encombrent personne).
          single_validation: singleValidation,
          ref_bon_physique: ref_bon_physique || "",
          sortie_type: sortie_type || null,
          scan_url: scan_url || null,
          fournisseur_nom: fournisseur_nom || null,
          beneficiaire: beneficiaire || null,
          motif_rebut: motif_rebut || null,
          justificatif_url: justificatif_url || null,
          status: initialStatus,
          validations: {
            magasinier: { by: movCreatedBy.userId || "", name: movCreatedBy.name || "", at: Date.now() }
          },
          // Traçabilité de la valorisation automatique (réceptions uniquement).
          valorisation: receptionValorisation,
          rejection: null,
          created_by: movCreatedBy,
          created_at: Date.now(),
          updated_at: Date.now(),
        };

        const docRef = await db_firestore.collection("stock_movements").add(movData);

        // L'impact est appliqué EXACTEMENT quand `isImpactApplied` affirme qu'il
        // l'est — la même fonction pure dont rebuildBalances se sert pour
        // recompter les soldes. Écrire un mouvement que cette fonction déclare
        // impactant sans appliquer l'impact (ou l'inverse) ferait diverger les
        // soldes du grand livre en silence. Ici la question ne se pose plus : le
        // code applique ce que le prédicat dit, il ne le redevine pas.
        if (isImpactApplied(movData)) {
          await applyStockImpact(movData);
        }

        return res.json({ success: true, id: docRef.id, numero, status: initialStatus, valorisation: receptionValorisation });
      }


      // --- LIST MOVEMENTS ---
      if (action === "list-movements") {
        const { type, status, ferme: movFerme, limit: movLimit, deleted } = req.query;
        // deleted=true → renvoie UNIQUEMENT les bons soft-deleted (historique des
        // suppressions). Sinon, comportement par défaut : exclut les supprimés.
        const onlyDeleted = deleted === "true" || deleted === "1";
        const lim = parseInt(movLimit || "200");
        let q = db_firestore.collection("stock_movements").orderBy("created_at", "desc").limit(lim);
        if (type) q = q.where("type", "==", type);
        if (status) q = q.where("status", "==", status);
        if (movFerme) q = q.where("ferme", "==", movFerme);
        const snap = await q.get();
        const movements = snap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((m) => onlyDeleted ? stockMovementGuard.isDeletedMovement(m) : !stockMovementGuard.isDeletedMovement(m));
        return res.json({ success: true, movements, count: movements.length });
      }


      // --- GET SINGLE MOVEMENT ---
      if (action === "get-movement") {
        const { id } = req.query;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        const snap = await db_firestore.collection("stock_movements").doc(id).get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        const movData = snap.data();
        if (stockMovementGuard.isDeletedMovement(movData)) {
          return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        }
        return res.json({ success: true, movement: { id: snap.id, ...movData } });
      }


      // --- VALIDATE MOVEMENT ---
      if (action === "validate-movement" && req.method === "POST") {
        const { id, validated_by, items: pricedItems } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });

        // Rôle RÉEL dérivé du token Firebase (anti-spoof body). Jamais req.body.role.
        const callerRole = await resolveCallerRole(authUser);
        if (!callerRole) return res.status(403).json({ success: false, error: "Rôle introuvable pour l'utilisateur authentifié" });

        const docRef = db_firestore.collection("stock_movements").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        const mov = snap.data();

        if (mov.status === "rejete") {
          return res.status(400).json({ success: false, error: "Mouvement rejeté, impossible de valider" });
        }

        // --- CHEMIN DE REPRISE — NE PAS SUPPRIMER ---
        //
        // Plus aucune réception n'est CRÉÉE en `en_attente_achats` (create-bl les
        // crée désormais en `valide_chef`, valorisées, stock appliqué). Mais 59
        // réceptions sont restées dans ce statut en production — 62 au
        // 27/08/2026, depuis le 5 juin, avec leurs 90 lignes TOUTES déjà
        // valorisées et leur marchandise jamais entrée en stock. Le compte
        // continue de monter jusqu'au déploiement : ne pas le lire comme figé.
        //
        // Retirer ce bloc les enfermerait dans un statut mort : plus aucune action
        // ne pourrait les faire entrer en stock, et leur reprise (partie D du
        // spec, GATED car elle modifie le stock réel) deviendrait impossible.
        // À supprimer seulement quand il n'en restera aucune.
        if (mov.status === "en_attente_achats") {
          if (mov.type !== "reception") {
            return res.status(400).json({ success: false, error: "Statut en_attente_achats réservé aux réceptions" });
          }
          if (callerRole !== "achats") {
            return res.status(403).json({ success: false, error: "Seul le profil Achats peut valider une réception" });
          }
          // Valorisation obligatoire : prix_unitaire numérique >= 0 pour chaque item.
          const provided = Array.isArray(pricedItems) ? pricedItems : [];
          const existingItems = mov.items || [];
          const valuedItems = [];
          for (let i = 0; i < existingItems.length; i++) {
            const orig = existingItems[i];
            // Match par index, sinon par ref/nom, sinon fallback au prix porté par l'item existant.
            let priced = provided[i];
            if (!priced) {
              priced = provided.find((p) =>
                (p.article_ref && p.article_ref === orig.article_ref) ||
                (p.article_nom && p.article_nom === orig.article_nom));
            }
            const rawPrice = priced && priced.prix_unitaire !== undefined && priced.prix_unitaire !== null && priced.prix_unitaire !== ""
              ? priced.prix_unitaire
              : orig.prix_unitaire;
            const prix = parseFloat(rawPrice);
            if (!Number.isFinite(prix) || prix < 0) {
              return res.status(400).json({ success: false, error: `Prix unitaire requis (>= 0) pour l'article ${orig.article_nom || orig.article_ref || "#" + (i + 1)}` });
            }
            valuedItems.push({ ...orig, prix_unitaire: prix });
          }

          await docRef.update({
            status: "valide_chef",
            items: valuedItems,
            "validations.achats": {
              by: (validated_by || {}).userId || "",
              name: (validated_by || {}).name || "",
              at: Date.now()
            },
            rejection: null,
            updated_at: Date.now()
          });

          const updatedSnap = await docRef.get();
          await applyStockImpact(updatedSnap.data());

          return res.json({ success: true, status: "valide_chef" });
        }

        // Determine expected validation sequence (chef valide directement depuis valide_mag)
        // Chemin legacy conservé : réceptions/mouvements déjà en valide_mag/valide_achats validés par le chef.
        let nextStatus = null;
        if ((callerRole === "chef_f1" || callerRole === "chef_f5" || callerRole === "chef_avo") && (mov.status === "valide_mag" || mov.status === "valide_achats")) {
          // Verify the chef matches the ferme
          const expectedChef = getChefProfileForFerme(mov.ferme);
          if (expectedChef && callerRole !== expectedChef) {
            return res.status(403).json({ success: false, error: `Seul ${expectedChef} peut valider pour ${mov.ferme}` });
          }
          nextStatus = "valide_chef";
        } else {
          return res.status(400).json({ success: false, error: `Validation ${callerRole} non applicable au statut ${mov.status}` });
        }

        const validationKey = "chef";
        await docRef.update({
          status: nextStatus,
          [`validations.${validationKey}`]: {
            by: (validated_by || {}).userId || "",
            name: (validated_by || {}).name || "",
            at: Date.now()
          },
          rejection: null,
          updated_at: Date.now()
        });

        // If fully validated, apply stock impact
        if (nextStatus === "valide_chef") {
          const updatedSnap = await docRef.get();
          await applyStockImpact(updatedSnap.data());
        }

        return res.json({ success: true, status: nextStatus });
      }


      // --- REJECT MOVEMENT ---
      if (action === "reject-movement" && req.method === "POST") {
        const { id, role, reason, rejected_by } = req.body;
        if (!id || !role || !reason) {
          return res.status(400).json({ success: false, error: "id, role et reason requis" });
        }

        const docRef = db_firestore.collection("stock_movements").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });

        await docRef.update({
          status: "rejete",
          rejection: {
            by: (rejected_by || {}).userId || "",
            name: (rejected_by || {}).name || "",
            role,
            reason,
            at: Date.now()
          },
          updated_at: Date.now()
        });

        return res.json({ success: true, status: "rejete" });
      }


      // --- UPDATE MOVEMENT (édition d'un bon non validé, non importé, par son créateur) ---
      if (action === "update-movement" && req.method === "POST") {
        const { id, patch } = req.body || {};
        if (!id || !patch || typeof patch !== "object") {
          return res.status(400).json({ success: false, error: "id et patch requis" });
        }
        const docRef = db_firestore.collection("stock_movements").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        const mov = snap.data();

        const requester = await resolveRequesterIdentity(authUser);
        // admin-cli (script/secret) garde les garde-fous import/validé mais saute le contrôle créateur.
        const evalRes = requester.isAdminCli
          ? (stockMovementGuard.isDeletedMovement(mov) ? { allowed: false, reason: "deleted" }
            : stockMovementGuard.isImportedMovement(mov) ? { allowed: false, reason: "imported" }
              : stockMovementGuard.isValidatedMovement(mov) ? { allowed: false, reason: "validated" }
                : { allowed: true, reason: null })
          : stockMovementGuard.evaluateMutable(mov, requester);
        if (!evalRes.allowed) {
          const code = evalRes.reason === "not_found" ? 404 : 403;
          return res.status(code).json({ success: false, error: stockMovementGuard.refusalMessage(evalRes.reason), reason: evalRes.reason });
        }

        // Champs éditables uniquement (whitelist) — pas de status / created_by / import_source / impact.
        const EDITABLE = [
          "date", "lieu_source", "lieu_destination", "ferme", "ref_bl_fournisseur",
          // `reception_libre_motif` retiré : plus aucun chemin n'écrit ce champ.
          // Les 2 documents historiques qui le portent le gardent tel quel.
          "fournisseur_nom", "ref_bon_physique", "beneficiaire",
          "sortie_type", "motif_rebut", "justificatif_url", "scan_url",
        ];
        const update = { updated_at: Date.now() };
        for (const k of EDITABLE) {
          if (Object.prototype.hasOwnProperty.call(patch, k)) update[k] = patch[k];
        }
        // Items : revalidés / normalisés comme à la création.
        if (Object.prototype.hasOwnProperty.call(patch, "items")) {
          if (!Array.isArray(patch.items) || patch.items.length === 0) {
            return res.status(400).json({ success: false, error: "items[] non vide requis" });
          }
          update.items = patch.items.map((it) => ({
            article_ref: it.article_ref || it.article || "",
            article_nom: it.article_nom || it.article || "",
            quantite: parseFloat(it.quantite) || 0,
            unite: it.unite || "kg",
          }));
        }
        // Bon non validé → aucun impact stock appliqué → pas de recalcul de soldes.
        update.history = (mov.history || []).concat([{
          action: "update", by: { userId: requester.userId, profileId: requester.profileId }, at: Date.now(),
        }]);

        await docRef.update(update);
        return res.json({ success: true, id });
      }


      // --- DELETE MOVEMENT (soft-delete) ---
      // Deux chemins :
      //  - Achats/DG (admin métier) : peut supprimer tout bon SAISI app (non importé),
      //    même validé, même s'il n'en est pas créateur. Si le bon était validé
      //    (impact matérialisé dans stock_balances), on annule l'impact (reverse).
      //  - Autres rôles (chemin historique) : créateur d'un bon non importé / non validé.
      if (action === "delete-movement" && req.method === "POST") {
        const { id, reason } = req.body || {};
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        const docRef = db_firestore.collection("stock_movements").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        const mov = snap.data();

        const requester = await resolveRequesterIdentity(authUser);
        const isAdminRole = stockMovementGuard.isAdminDeleter(requester);

        let reverse = false;
        if (isAdminRole) {
          // Chemin Achats/DG : seul garde-fou = bon déjà supprimé OU importé.
          // PAS de restriction validé / créateur (cf. evaluateAdminDelete).
          const adminEval = stockMovementGuard.evaluateAdminDelete(mov, requester);
          if (!adminEval.allowed) {
            const code = adminEval.reason === "deleted" ? 400 : 403;
            const msg = adminEval.reason === "imported"
              ? "Bon importé du grand livre : non supprimable"
              : stockMovementGuard.refusalMessage(adminEval.reason);
            return res.status(code).json({ success: false, error: msg, reason: adminEval.reason });
          }
          // Si le bon était validé, son impact est matérialisé dans stock_balances → on l'annule.
          reverse = stockMovementGuard.isValidatedMovement(mov);
        } else {
          // Chemin historique : créateur, non importé, non validé.
          const evalRes = requester.isAdminCli
            ? (stockMovementGuard.isDeletedMovement(mov) ? { allowed: false, reason: "deleted" }
              : stockMovementGuard.isImportedMovement(mov) ? { allowed: false, reason: "imported" }
                : stockMovementGuard.isValidatedMovement(mov) ? { allowed: false, reason: "validated" }
                  : { allowed: true, reason: null })
            : stockMovementGuard.evaluateMutable(mov, requester);
          if (!evalRes.allowed) {
            const code = evalRes.reason === "not_found" ? 404 : 403;
            return res.status(code).json({ success: false, error: stockMovementGuard.refusalMessage(evalRes.reason), reason: evalRes.reason });
          }
        }

        const cleanReason = typeof reason === "string" ? reason.trim() : "";

        // Annule l'impact stock AVANT le soft-delete (le bon est encore "validé"
        // dans son état courant ; reverseStockImpact applique l'inverse de applyStockImpact).
        if (reverse) {
          await reverseStockImpact(mov);
        }

        await docRef.update({
          deleted: true,
          deleted_by: { userId: requester.userId, profileId: requester.profileId },
          deleted_at: Date.now(),
          deleted_reason: cleanReason || null,
          updated_at: Date.now(),
          history: (mov.history || []).concat([{
            action: "delete",
            by: { userId: requester.userId, profileId: requester.profileId },
            at: Date.now(),
            reason: cleanReason || null,
          }]),
        });

        // Cascade BR → BL → BDC : un BR (reception) supprimé doit aussi neutraliser
        // le BL jumeau (créé ensemble par create-bl) et recalculer delivery_status
        // du BDC parent (calculé uniquement à partir des delivery_notes non supprimés).
        if (mov.type === "reception" && mov.bdc_id) {
          if (mov.bl_id) {
            const blRef = db_firestore.collection("delivery_notes").doc(mov.bl_id);
            const blSnap = await blRef.get();
            if (blSnap.exists && !blSnap.data().deleted) {
              await blRef.update({
                deleted: true,
                deleted_by: { userId: requester.userId, profileId: requester.profileId },
                deleted_at: Date.now(),
              });
            }
          }
          const bdcSnap = await db_firestore.collection("purchase_orders").doc(mov.bdc_id).get();
          if (bdcSnap.exists) {
            const bdc = bdcSnap.data();
            const remainingBlSnap = await db_firestore.collection("delivery_notes").where("bdc_id", "==", mov.bdc_id).get();
            const remainingBls = remainingBlSnap.docs.map((d) => d.data()).filter((bl) => !bl.deleted);
            const received = bdcReceptionGuard.computeReceivedByArticle(remainingBls);
            const ordered = bdcReceptionGuard.computeOrderedByArticle(bdc.items || []);
            const deliveryStatus = bdcReceptionGuard.deriveDeliveryStatus(ordered, received);
            await db_firestore.collection("purchase_orders").doc(mov.bdc_id).update({ delivery_status: deliveryStatus, updated_at: Date.now() });
          }
        }

        return res.json({ success: true, id, reversed: reverse });
      }


      // --- GET CONSUMPTION COSTS BY VARIETY ---
      if (action === "get-consumption-costs") {
        const snap = await db_firestore.collection("consumption_costs_by_variety").get();
        const data = {};
        snap.docs.forEach(d => { data[d.id] = d.data(); });
        return res.json({ success: true, data });
      }


      // --- GET BALANCES ---
      if (action === "get-balances") {
        const { lieu_type, lieu_id } = req.query;
        let q = db_firestore.collection("stock_balances");
        if (lieu_type) q = q.where("lieu_type", "==", lieu_type);
        if (lieu_id) q = q.where("lieu_id", "==", lieu_id);
        const snap = await q.get();
        const balances = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        balances.sort((a, b) => (b.balance || 0) - (a.balance || 0));
        return res.json({ success: true, balances, count: balances.length });
      }


      // --- GET BALANCES AT DATE (recalcul historique) ---
      if (action === "get-balances-at-date") {
        const { date } = req.query;
        if (!date) return res.status(400).json({ success: false, error: "date requis (YYYY-MM-DD)" });

        const snap = await db_firestore.collection("stock_movements")
          .where("date", "<=", date)
          .get();

        const balMap = {};
        for (const doc of snap.docs) {
          const m = doc.data();
          if (stockMovementGuard.isDeletedMovement(m)) continue; // exclusion défensive soft-delete
          const needsMulti = m.type === "reception" || m.type === "sortie";
          if (needsMulti && m.status !== "valide_chef") continue;
          if (!m.status) continue;

          for (const item of (m.items || [])) {
            const ref = item.article_ref || "";
            const nom = item.article_nom || "";
            const qty = parseFloat(item.quantite) || 0;
            const unite = item.unite || "kg";
            if (qty <= 0 || !ref) continue;

            if (m.lieu_source && m.lieu_source.id) {
              const key = `${m.lieu_source.type}|${m.lieu_source.id}|${ref}`;
              if (!balMap[key]) balMap[key] = { lieu_type: m.lieu_source.type, lieu_id: m.lieu_source.id, article_ref: ref, article_nom: nom, unite, balance: 0 };
              balMap[key].balance -= qty;
            }
            if (m.lieu_destination && m.lieu_destination.id && m.lieu_destination.type !== "parcelle") {
              const key = `${m.lieu_destination.type}|${m.lieu_destination.id}|${ref}`;
              if (!balMap[key]) balMap[key] = { lieu_type: m.lieu_destination.type, lieu_id: m.lieu_destination.id, article_ref: ref, article_nom: nom, unite, balance: 0 };
              balMap[key].balance += qty;
            }
          }
        }

        const balances = Object.values(balMap)
          .map(b => ({ ...b, balance: Math.round(b.balance * 100) / 100 }))
          .filter(b => Math.abs(b.balance) >= 0.01)
          .sort((a, b) => (b.balance || 0) - (a.balance || 0));

        return res.json({ success: true, balances, count: balances.length, date });
      }


      // --- GET ARTICLE HISTORY (grand livre de stock par article) ---
      // Lecture seule. Reproduit EXACTEMENT les exclusions de get-balances-at-date
      // pour garantir la cohérence du cumul avec les soldes officiels.
      if (action === "get-article-history") {
        const articleParam = (req.query.article || "").trim();
        const filterLieuId = req.query.lieu_id || null;
        if (!articleParam) return res.status(400).json({ success: false, error: "article requis (article_ref ou article_nom)" });
        // Index grand-livre de TOUS les articles, mis en cache mémoire (TTL 5 min).
        // Le scan + agrégation stock_movements se fait UNE fois ; chaque article
        // est ensuite servi instantanément depuis l'index. Sémantique IDENTIQUE
        // à l'ancienne logique inline (cf. lib/stock/articleHistoryIndex.js).
        const articleIndex = await getArticleHistoryIndex(db_firestore);
        const slice = sliceArticleHistory(articleIndex, articleParam, filterLieuId);

        return res.json({ success: true, ...slice });
      }

  return NOT_HANDLED;
};
