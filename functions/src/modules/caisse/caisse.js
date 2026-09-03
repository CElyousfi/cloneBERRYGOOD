/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { admin, db_firestore, functions, requireAuth, setCors } = require("../../shared/core");

const caisseImport = require("../../../lib/caisseImport");
const { computeSoldeDelta, isTypeEditable } = require("../../../lib/caisse/soldeDelta");
const { periodesAVerifier } = require("../../../lib/caisse/rapprochementLock");
const { computeChanges } = require("../../../lib/caisse/txDiff");
const caisseAxes = require("../../../lib/caisse/champsAnalytiques");
const { planBatchValidation, applyDelta } = require("../../../lib/caisse/batchValidation");
const caisseParametres = require("../../../lib/caisse/parametres");
const caisseSoldeProvisoire = require("../../../lib/caisse/soldeProvisoire");
const caisseEntites = require("../../../lib/caisse/entites");
const { planEncaissementWrites } = require("../../../lib/marcheLocalCaisse/applyEncaissements");
const CAISSE_PROFILES_SAISIE = ["achats"];
const CAISSE_PROFILES_CONTROLE = ["dg", "finance"];

exports.caisseManagement = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB", secrets: ["ADMIN_SECRET"] })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const action = req.query.action || req.body?.action || "dashboard";
    const adminSecret = process.env.ADMIN_SECRET;

    // ========== BULK IMPORT (admin-secret protected, no Firebase Auth) ==========
    if (action === "bulk-import-transactions" && req.method === "POST") {
      if (req.body.secret !== adminSecret) {
        return res.status(403).json({ success: false, error: "forbidden" });
      }
      try {
        const { caisse_id, transactions, reset_solde_initial, force_overwrite, caisse_def } = req.body;
        if (!caisse_id || !Array.isArray(transactions)) {
          return res.status(400).json({ success: false, error: "caisse_id et transactions[] requis" });
        }

        const caisseRef = db_firestore.collection("caisse_definitions").doc(caisse_id);
        const caisseDoc = await caisseRef.get();

        // Auto-seed the 4 default caisses + the target caisse if it doesn't exist
        if (!caisseDoc.exists) {
          const DEFAULT_CAISSES = {
            caisse_paie: { nom: "Caisse Paie", description: "Caisse pour les paiements salariaux" },
            caisse_depenses: { nom: "Caisse Dépenses", description: "Caisse pour les dépenses courantes" },
            caisse_marche_local_f1: { nom: "Caisse Marché Local F1", description: "Caisse du marché local Ferme 1" },
            caisse_marche_local_f5: { nom: "Caisse Marché Local F5", description: "Caisse du marché local Ferme 5" },
          };
          const seedBatch = db_firestore.batch();
          const importer = { uid: "import-script", email: "import@berrygood.ma", profileId: "admin", name: "Import Excel" };
          const nowTs = admin.firestore.FieldValue.serverTimestamp();
          for (const [id, def] of Object.entries(DEFAULT_CAISSES)) {
            const ref = db_firestore.collection("caisse_definitions").doc(id);
            const existing = await ref.get();
            if (!existing.exists) {
              seedBatch.set(ref, {
                nom: def.nom, description: def.description,
                solde_initial: 0, solde_actuel: 0,
                devise: "MAD", is_default: true, active: true,
                created_by: importer, created_at: nowTs, updated_at: nowTs,
              });
            }
          }
          // If the target caisse is NOT a default, create it from caisse_def or fallback
          if (!DEFAULT_CAISSES[caisse_id]) {
            const ref = db_firestore.collection("caisse_definitions").doc(caisse_id);
            const existing = await ref.get();
            if (!existing.exists) {
              const customDef = caisse_def || {};
              seedBatch.set(ref, {
                nom: customDef.nom || caisse_id,
                description: customDef.description || "",
                solde_initial: 0, solde_actuel: 0,
                devise: "MAD", is_default: false, active: true,
                created_by: importer, created_at: nowTs, updated_at: nowTs,
              });
            }
          }
          await seedBatch.commit();
        }

        if (typeof reset_solde_initial === "number") {
          await caisseRef.update({
            solde_initial: reset_solde_initial,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        const importer = { uid: "import-script", email: "import@berrygood.ma", profileId: "admin", name: "Import Excel" };
        let imported = 0, skipped = 0;

        // Process in batches (Firestore limit = 500 ops per batch)
        const BATCH_SIZE = 400;
        for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
          const slice = transactions.slice(i, i + BATCH_SIZE);
          const refs = slice.map(tx => db_firestore.collection("caisse_transactions").doc(tx.external_id));
          const docs = await Promise.all(refs.map(r => r.get()));
          const batch = db_firestore.batch();
          slice.forEach((tx, idx) => {
            if (docs[idx].exists && !force_overwrite) { skipped++; return; }
            const now = Date.now();
            batch.set(refs[idx], {
              caisse_id: tx.caisse_id,
              type: tx.type,
              montant: tx.montant,
              reference: tx.reference || "",
              description: tx.description || "",
              code_analytique: tx.code_analytique || "",
              fournisseur: tx.fournisseur || "",
              date: tx.date,
              status: "valide",
              files: [],
              saisie_by: importer,
              soumis_par: importer,
              soumis_at: admin.firestore.FieldValue.serverTimestamp(),
              valide_par: importer,
              valide_at: admin.firestore.FieldValue.serverTimestamp(),
              created_at: admin.firestore.FieldValue.serverTimestamp(),
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
              history: [
                { action: "import", by: importer, at: now, source: tx._meta || {} },
                { action: "validation", by: importer, at: now },
              ],
              _import_meta: tx._meta || {},
            });
            imported++;
          });
          await batch.commit();
        }

        // Recompute caisse balance from all VALIDATED transactions
        const allTxSnap = await db_firestore.collection("caisse_transactions")
          .where("caisse_id", "==", caisse_id)
          .where("status", "==", "valide")
          .get();
        let totalIn = 0, totalOut = 0;
        allTxSnap.docs.forEach(d => {
          const tx = d.data();
          if (tx.type === "alimentation" || tx.type === "transfer_in") totalIn += (tx.montant || 0);
          else if (tx.type === "depense" || tx.type === "sortie" || tx.type === "transfer_out") totalOut += (tx.montant || 0);
        });

        const updatedCaisseDoc = await caisseRef.get();
        const soldeInitial = updatedCaisseDoc.data().solde_initial || 0;
        const soldeActuel = soldeInitial + totalIn - totalOut;
        await caisseRef.update({ solde_actuel: soldeActuel, updated_at: admin.firestore.FieldValue.serverTimestamp() });

        return res.json({
          success: true, imported, skipped,
          total_transactions: allTxSnap.size,
          solde_initial: soldeInitial, solde_actuel: soldeActuel,
          total_in: totalIn, total_out: totalOut,
        });
      } catch (err) {
        console.error("Erreur bulk-import:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // ========== STANDARD AUTH FLOW ==========
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    // Lookup user profile
    const userDoc = await db_firestore.collection("users").doc(authUser.uid).get();
    const userProfile = userDoc.exists ? userDoc.data() : {};
    const profileId = userProfile.profileId || "";

    const isSaisie = CAISSE_PROFILES_SAISIE.includes(profileId);
    const isControle = CAISSE_PROFILES_CONTROLE.includes(profileId);
    const isAdmin = userProfile.role === "admin";
    const hasAccess = isSaisie || isControle || isAdmin;

    if (!hasAccess) return res.status(403).json({ success: false, error: "Accès non autorisé à la gestion de caisse" });

    const userInfo = { uid: authUser.uid, email: authUser.email || "", profileId, name: userProfile.fullName || userProfile.name || authUser.email || "" };

    try {
      // ========== DASHBOARD ==========
      if (action === "dashboard") {
        const caissesSnap = await db_firestore.collection("caisse_definitions").where("active", "==", true).get();
        const caisses = caissesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Bons engagés mais pas encore validés. Une seule requête sert deux
        // besoins : le compteur « en attente de validation » (soumis seulement,
        // c'est la file de la DG) et le SOLDE EN CAISSE, qui doit aussi tenir
        // compte des bons « à revoir » — l'argent est sorti dans les deux cas.
        const enAttenteSnap = await db_firestore.collection("caisse_transactions")
          .where("status", "in", caisseSoldeProvisoire.STATUTS_EN_ATTENTE).get();
        const enAttenteTx = enAttenteSnap.docs.map(d => d.data());
        const pendingCount = enAttenteTx.filter(t => t.status === "soumis").length;

        // Solde en caisse = solde validé + bons engagés. AFFICHAGE uniquement :
        // solde_actuel reste le solde comptable, seul utilisé par le
        // rapprochement mensuel (cf. functions/lib/caisse/soldeProvisoire.js).
        // Rattachement caisse → entité, pour que le dashboard puisse présenter
        // une entité à la fois sans deviner à partir des noms.
        const paramDoc = await db_firestore.collection("caisse_parametres").doc("default").get();
        const parametresCaisse = caisseParametres.withDefaults(paramDoc.exists ? paramDoc.data() : null);

        const soldesProvisoires = caisseSoldeProvisoire.computeSoldesProvisoires(caisses, enAttenteTx);
        const soldesParCaisse = {};
        soldesProvisoires.forEach(s => { soldesParCaisse[s.caisse_id] = s; });
        caisses.forEach(c => {
          const s = soldesParCaisse[c.id];
          if (!s) return;
          c.solde_provisoire = s.solde_provisoire;
          c.en_attente_montant = s.en_attente_montant;
          c.en_attente_count = s.en_attente_count;
        });

        // This week totals (Saturday to Friday)
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
        const daysSinceSat = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - daysSinceSat);
        weekStart.setHours(0, 0, 0, 0);
        const weekStartStr = weekStart.toISOString().slice(0, 10);

        // Weekly totals — wrapped in try/catch so a missing composite index
        // (status ASC, date ASC) doesn't bring down the whole dashboard.
        // Degraded mode: returns 0/0 + an indicator instead of failing.
        let weekAlimentations = 0, weekDepenses = 0, weeklyDegraded = false;
        try {
          const weekTxSnap = await db_firestore.collection("caisse_transactions")
            .where("status", "==", "valide")
            .where("date", ">=", weekStartStr)
            .get();
          weekTxSnap.docs.forEach(d => {
            const tx = d.data();
            if (tx.type === "alimentation" || tx.type === "transfer_in") weekAlimentations += (tx.montant || 0);
            if (tx.type === "depense" || tx.type === "sortie" || tx.type === "transfer_out") weekDepenses += (tx.montant || 0);
          });
        } catch (e) {
          console.warn("[dashboard] weekly query failed (likely index building):", e.message);
          weeklyDegraded = true;
        }

        // Recent transactions (last 10) — same defensive wrap
        let recentTx = [];
        try {
          const recentSnap = await db_firestore.collection("caisse_transactions")
            .orderBy("created_at", "desc").limit(10).get();
          recentTx = recentSnap.docs.map(d => ({ id: d.id, ...d.data(), created_at: d.data().created_at?.toMillis?.() || d.data().created_at }));
        } catch (e) {
          console.warn("[dashboard] recent query failed:", e.message);
        }

        return res.json({
          success: true, caisses, pendingCount, weekAlimentations, weekDepenses, recentTx, weeklyDegraded,
          // Seul le rattachement aux entités intéresse le dashboard ; inutile de
          // lui renvoyer les parcelles figées, qui peuvent être volumineuses.
          parametres: { entites: parametresCaisse.entites },
        });
      }

      // ========== LIST CAISSES ==========
      if (action === "list-caisses") {
        const snap = await db_firestore.collection("caisse_definitions").where("active", "==", true).get();
        const caisses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, caisses });
      }

      // ========== CREATE CAISSE ==========
      if (action === "create-caisse" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut créer une caisse" });
        const { nom, description } = req.body;
        if (!nom) return res.status(400).json({ success: false, error: "Nom de la caisse requis" });
        const now = admin.firestore.FieldValue.serverTimestamp();
        const docRef = await db_firestore.collection("caisse_definitions").add({
          nom, description: description || "", solde_initial: 0, solde_actuel: 0,
          devise: "MAD", is_default: false, active: true,
          created_by: userInfo, created_at: now, updated_at: now,
        });
        return res.json({ success: true, id: docRef.id });
      }

      // ========== UPDATE CAISSE ==========
      if (action === "update-caisse" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut modifier une caisse" });
        const { id, nom, description } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const updates = { updated_at: admin.firestore.FieldValue.serverTimestamp() };
        if (nom !== undefined) updates.nom = nom;
        if (description !== undefined) updates.description = description;
        await db_firestore.collection("caisse_definitions").doc(id).update(updates);
        return res.json({ success: true });
      }

      // ========== LIST TRANSACTIONS ==========
      if (action === "list-transactions") {
        const caisseId = req.query.caisse_id;
        const status = req.query.status;
        const dateFrom = req.query.date_from;
        const dateTo = req.query.date_to;
        const limit = parseInt(req.query.limit) || 100;

        let query = db_firestore.collection("caisse_transactions");
        if (caisseId) query = query.where("caisse_id", "==", caisseId);
        if (status) query = query.where("status", "==", status);
        if (dateFrom) query = query.where("date", ">=", dateFrom);
        if (dateTo) query = query.where("date", "<=", dateTo);
        query = query.orderBy("date", "desc").limit(limit);

        const snap = await query.get();
        const transactions = snap.docs.map(d => {
          const data = d.data();
          return { id: d.id, ...data, created_at: data.created_at?.toMillis?.() || data.created_at, updated_at: data.updated_at?.toMillis?.() || data.updated_at };
        });
        return res.json({ success: true, transactions });
      }

      // ========== CREATE TRANSACTION ==========
      if (action === "create-transaction" && req.method === "POST") {
        if (!isSaisie && !isAdmin) return res.status(403).json({ success: false, error: "Seul le service Achats peut saisir des transactions" });
        const { caisse_id, type, montant, reference, description, code_analytique, date, files, submit,
          matricule, beneficiaire_nom, ferme, culture, parcelle } = req.body;
        if (!caisse_id || !type || !montant || !date) return res.status(400).json({ success: false, error: "caisse_id, type, montant et date sont requis" });
        // Axes analytiques (facultatifs) : ferme / campagne / culture / parcelle.
        // La campagne n'est jamais reçue du client : elle est DÉRIVÉE de la date,
        // pour qu'un bon dont on corrige la date change de campagne tout seul.
        // Fermes autorisées = celles configurées dans Paramètres de la caisse.
                const _paramsDoc = await db_firestore.collection("caisse_parametres").doc("default").get();
                const _params = caisseParametres.withDefaults(_paramsDoc.exists ? _paramsDoc.data() : null);
                const axesErr = caisseAxes.validateAxes({ ferme, culture }, { fermes: _params.fermes });
        if (axesErr) return res.status(400).json({ success: false, error: axesErr });
        if (!["alimentation", "depense", "sortie", "paie", "transport"].includes(type)) return res.status(400).json({ success: false, error: "Type invalide" });
        if (montant <= 0) return res.status(400).json({ success: false, error: "Le montant doit être positif" });

        // Verify caisse exists
        const caisseDoc = await db_firestore.collection("caisse_definitions").doc(caisse_id).get();
        if (!caisseDoc.exists || !caisseDoc.data().active) return res.status(404).json({ success: false, error: "Caisse introuvable" });

        // Generate reference if not provided
        const refNum = reference || `REF-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;

        const now = admin.firestore.FieldValue.serverTimestamp();
        const status = submit ? "soumis" : "brouillon";
        const txData = {
          caisse_id, type, montant: parseFloat(montant), reference: refNum,
          description: description || "", code_analytique: code_analytique || "",
          matricule: matricule || "", beneficiaire_nom: beneficiaire_nom || "",
          ferme: ferme || "", culture: culture || "", parcelle: parcelle || "",
          campagne: caisseAxes.campagneOf(date),
          date, status, files: (files || []).slice(0, 3), // Max 3 files
          saisie_by: userInfo, created_at: now, updated_at: now,
          history: [{ action: "creation", by: userInfo, at: Date.now() }],
        };
        if (submit) {
          txData.soumis_par = userInfo;
          txData.soumis_at = now;
          txData.history.push({ action: "soumission", by: userInfo, at: Date.now() });
        }

        const docRef = await db_firestore.collection("caisse_transactions").add(txData);
        return res.json({ success: true, id: docRef.id, reference: refNum });
      }

      // ========== APPLY ENCAISSEMENTS (Marché Local — compte client) ==========
      // Action SÉPARÉE de create-transaction : les encaissements (type='encaissement')
      // sont écrits exclusivement ici. NE PAS ajouter 'encaissement'/'vente' à la
      // whitelist de create-transaction. Séparation des rôles : seul DG/Finance
      // peut appliquer (Achats NE peut PAS). dryRun=true -> aucune écriture.
      if (action === "apply-encaissements" && req.method === "POST") {
        if (!isControle && !isAdmin) {
          return res.status(403).json({ success: false, error: "Seul DG/Finance peut appliquer des encaissements" });
        }

        const lignes = Array.isArray(req.body.lignes) ? req.body.lignes : null;
        const dryRun = req.body.dryRun === true;
        if (!lignes) {
          return res.status(400).json({ success: false, error: "lignes[] requis" });
        }

        // Référentiel des comptes clients actifs : caisse_definitions dont
        // l'id commence par 'compte_client_' et active === true.
        const caissesSnap = await db_firestore.collection("caisse_definitions").where("active", "==", true).get();
        const activeClientIds = new Set();
        caissesSnap.docs.forEach(d => {
          if (d.id.startsWith("compte_client_")) {
            activeClientIds.add(d.id.slice("compte_client_".length));
          }
        });

        // Clés d'idempotence déjà présentes en base (encaissements existants).
        const existingSnap = await db_firestore.collection("caisse_transactions")
          .where("type", "==", "encaissement").get();
        const existingKeys = new Set();
        existingSnap.docs.forEach(d => {
          const k = d.data().idempotency_key;
          if (k) existingKeys.add(k);
        });

        const plan = planEncaissementWrites(lignes, existingKeys, { activeClientIds });

        // ---- DRY-RUN : aucune écriture, on retourne le plan. ----
        if (dryRun) {
          return res.json({
            success: true,
            dryRun: true,
            toCreate: plan.toCreate.length,
            duplicates: plan.duplicates,
            errors: plan.errors.map(e => ({ ligne: e.ligne, raison: e.raison })),
          });
        }

        // ---- WRITE RÉEL (gated : nécessite deploy functions, hors scope 4.3). ----
        const now = admin.firestore.FieldValue.serverTimestamp();
        const saisi_par = { uid: userInfo.uid, profileId: userInfo.profileId, name: userInfo.name };

        // BACKUP des caisses compte_client_* impactées (restore point, NO-DELETE).
        const impactedClientIds = new Set(plan.toCreate.map(w => w.client_id));
        const backupBatch = db_firestore.batch();
        const backupId = `enc_apply_${Date.now()}`;
        for (const cid of impactedClientIds) {
          const caisseId = "compte_client_" + cid;
          const cDoc = await db_firestore.collection("caisse_definitions").doc(caisseId).get();
          if (cDoc.exists) {
            const bref = db_firestore.collection("caisse_backups").doc(backupId)
              .collection("caisse_definitions").doc(caisseId);
            backupBatch.set(bref, { ...cDoc.data(), _backup_at: now, _backup_reason: "apply-encaissements" });
          }
        }
        await backupBatch.commit();

        // Écriture set(merge) des encaissements — idempotent par doc id. NO-DELETE.
        let created = 0;
        const CHUNK = 400;
        for (let i = 0; i < plan.toCreate.length; i += CHUNK) {
          const slice = plan.toCreate.slice(i, i + CHUNK);
          const batch = db_firestore.batch();
          for (const w of slice) {
            const ref = db_firestore.collection("caisse_transactions").doc(w.doc_id);
            batch.set(ref, {
              type: "encaissement",
              source: "canevas",
              caisse_id: "compte_client_" + w.client_id,
              client_id: w.client_id,
              montant: w.montant,
              date: w.date,
              mode: w.mode,
              reference: w.reference,
              reference_norm: w.reference_norm,
              motif: w.motif,
              idempotency_key: w.idempotency_key,
              status: "valide",
              version: 1,
              saisi_par,
              saisi_le: now,
              created_at: now,
              updated_at: now,
            }, { merge: true });
            created++;
          }
          await batch.commit();
        }

        // Recalcul du solde_actuel de chaque caisse compte_client_* impactée
        // = Σ vente − Σ encaissement (transactions validées).
        for (const cid of impactedClientIds) {
          const caisseId = "compte_client_" + cid;
          const txSnap = await db_firestore.collection("caisse_transactions")
            .where("caisse_id", "==", caisseId)
            .where("status", "==", "valide")
            .get();
          let totalVente = 0, totalEnc = 0;
          txSnap.docs.forEach(d => {
            const tx = d.data();
            if (tx.type === "vente") totalVente += (tx.montant || 0);
            else if (tx.type === "encaissement") totalEnc += (tx.montant || 0);
          });
          const soldeActuel = Math.round((totalVente - totalEnc) * 100) / 100;
          await db_firestore.collection("caisse_definitions").doc(caisseId)
            .update({ solde_actuel: soldeActuel, updated_at: now });
        }

        return res.json({
          success: true,
          created,
          duplicatesIgnored: plan.duplicates,
          errors: plan.errors.map(e => ({ ligne: e.ligne, raison: e.raison })),
        });
      }

      // ========== UPDATE TRANSACTION ==========
      // Modification d'un bon APRÈS création — jusqu'au statut 'valide' inclus.
      // Spec : docs/spec-modification-bon-caisse.md
      //
      // Règles clés :
      //  - modifier un bon 'valide' le DÉVALIDE (retour 'soumis') et annule son
      //    delta d'origine sur solde_actuel ; le nouveau delta sera appliqué à la
      //    re-validation par validate-transaction (pas de duplication de formule) ;
      //  - refus si le rapprochement du mois source OU cible est clôturé ;
      //  - 'reference' est GELÉE (identifiant métier du bon papier) ;
      //  - transferts et mouvements de compte client non modifiables ici.
      if (action === "update-transaction" && req.method === "POST") {
        if (!isSaisie && !isControle && !isAdmin) return res.status(403).json({ success: false, error: "Accès non autorisé à la modification de transactions" });
        const { id, caisse_id, type, montant, description, code_analytique, date, files,
          matricule, beneficiaire_nom, ferme, culture, parcelle } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        // Fermes autorisées = celles configurées dans Paramètres de la caisse.
                const _paramsDoc = await db_firestore.collection("caisse_parametres").doc("default").get();
                const _params = caisseParametres.withDefaults(_paramsDoc.exists ? _paramsDoc.data() : null);
                const axesErr = caisseAxes.validateAxes({ ferme, culture }, { fermes: _params.fermes });
        if (axesErr) return res.status(400).json({ success: false, error: axesErr });

        const txRef = db_firestore.collection("caisse_transactions").doc(id);
        const doc = await txRef.get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Transaction introuvable" });
        const current = doc.data();

        // --- Gardes de statut / type / propriété ---
        const STATUTS_EDITABLES = ["brouillon", "soumis", "a_revoir", "rejete", "valide"];
        if (!STATUTS_EDITABLES.includes(current.status)) {
          return res.status(400).json({ success: false, error: `Une transaction au statut « ${current.status} » ne peut pas être modifiée` });
        }
        if (!isTypeEditable(current.type)) {
          return res.status(400).json({ success: false, error: "Un transfert ou un mouvement de compte client ne se modifie pas ici" });
        }
        // Achats (sans rôle de contrôle) : ses propres saisies uniquement.
        if (!isControle && !isAdmin && current.saisie_by?.uid !== authUser.uid) {
          return res.status(403).json({ success: false, error: "Vous ne pouvez modifier que vos propres transactions" });
        }

        // --- Validation des champs entrants (alignée sur create-transaction) ---
        if (type !== undefined && !isTypeEditable(type)) {
          return res.status(400).json({ success: false, error: "Type invalide" });
        }
        let montantNum;
        if (montant !== undefined) {
          montantNum = parseFloat(montant);
          if (!Number.isFinite(montantNum) || montantNum <= 0) {
            return res.status(400).json({ success: false, error: "Le montant doit être un nombre positif" });
          }
        }
        if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
          return res.status(400).json({ success: false, error: "Date invalide (format attendu AAAA-MM-JJ)" });
        }
        if (caisse_id !== undefined && caisse_id !== current.caisse_id) {
          const caisseDoc = await db_firestore.collection("caisse_definitions").doc(caisse_id).get();
          if (!caisseDoc.exists || !caisseDoc.data().active) {
            return res.status(404).json({ success: false, error: "Caisse introuvable ou inactive" });
          }
        }

        // --- Patch effectif (seuls les champs fournis) ---
        const patch = {};
        if (caisse_id !== undefined) patch.caisse_id = caisse_id;
        if (type !== undefined) patch.type = type;
        if (montantNum !== undefined) patch.montant = montantNum;
        if (description !== undefined) patch.description = description;
        if (code_analytique !== undefined) patch.code_analytique = code_analytique;
        if (date !== undefined) patch.date = date;
        if (matricule !== undefined) patch.matricule = matricule;
        if (beneficiaire_nom !== undefined) patch.beneficiaire_nom = beneficiaire_nom;
        if (files !== undefined) patch.files = (files || []).slice(0, 3);
        if (ferme !== undefined) patch.ferme = ferme;
        if (culture !== undefined) patch.culture = culture;
        if (parcelle !== undefined) patch.parcelle = parcelle;
        // Campagne DÉRIVÉE de la date, jamais saisie : corriger la date d'un bon
        // le fait changer de campagne automatiquement. Recalculée aussi quand la
        // date ne bouge pas, pour rattraper les bons créés avant ce champ.
        if (patch.date !== undefined || !current.campagne) {
          patch.campagne = caisseAxes.campagneOf(patch.date !== undefined ? patch.date : current.date);
        }

        const changes = computeChanges(current, patch);
        if (changes.length === 0) {
          return res.json({ success: true, status: current.status, devalidated: false, changes: [] });
        }

        // --- Verrou rapprochement (période source ET cible) ---
        // Appliqué si le bon pèse sur le solde théorique (validé) ou s'il change
        // de position (date / caisse) — pour ne pas le déplacer vers un mois clos.
        const positionChange = changes.some((c) => c.field === "date" || c.field === "caisse_id");
        if (current.status === "valide" || positionChange) {
          const periodes = periodesAVerifier(
            { caisse_id: current.caisse_id, date: current.date },
            { caisse_id: patch.caisse_id !== undefined ? patch.caisse_id : current.caisse_id,
              date: patch.date !== undefined ? patch.date : current.date }
          );
          const rapDocs = await Promise.all(
            periodes.map((p) => db_firestore.collection("caisse_rapprochements").doc(p.docId).get())
          );
          for (let i = 0; i < rapDocs.length; i++) {
            if (rapDocs[i].exists && rapDocs[i].data().statut === "cloture") {
              return res.status(400).json({
                success: false,
                error: `Modification impossible : le rapprochement de ${periodes[i].label} est clôturé.`,
              });
            }
          }
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        const devalidated = current.status === "valide";

        if (!devalidated) {
          // Aucun solde en jeu : write simple.
          await txRef.update({
            ...patch,
            updated_at: now,
            history: [...(current.history || []), { action: "modification", by: userInfo, at: Date.now(), changes }],
          });
          return res.json({ success: true, status: current.status, devalidated: false, changes });
        }

        // --- Cas validé : dévalidation + annulation atomique du delta d'origine ---
        await db_firestore.runTransaction(async (t) => {
          const txDoc = await t.get(txRef);
          if (!txDoc.exists) throw new Error("Transaction introuvable");
          const txData = txDoc.data();
          // Relecture DANS la transaction : une validation/dévalidation concurrente
          // a pu changer le statut entre-temps.
          if (txData.status !== "valide") throw new Error("La transaction n'est plus validée — rechargez la liste");

          const caisseRef = db_firestore.collection("caisse_definitions").doc(txData.caisse_id);
          const caisseDoc = await t.get(caisseRef);
          if (!caisseDoc.exists) throw new Error("Caisse introuvable");

          // Delta calculé sur les valeurs D'AVANT modification, imputé sur la
          // caisse D'AVANT modification. Le nouveau delta viendra de la re-validation.
          const deltaOrigine = computeSoldeDelta({ type: txData.type, montant: txData.montant });
          const newSolde = Math.round(((caisseDoc.data().solde_actuel || 0) - deltaOrigine) * 100) / 100;

          t.update(txRef, {
            ...patch,
            status: "soumis",
            soumis_par: userInfo,
            soumis_at: now,
            valide_par: admin.firestore.FieldValue.delete(),
            valide_at: admin.firestore.FieldValue.delete(),
            updated_at: now,
            history: [...(txData.history || []), { action: "modification", by: userInfo, at: Date.now(), changes, devalidated: true }],
          });
          t.update(caisseRef, { solde_actuel: newSolde, updated_at: now });
        });

        return res.json({ success: true, status: "soumis", devalidated: true, changes });
      }

      // ========== SUBMIT TRANSACTION ==========
      if (action === "submit-transaction" && req.method === "POST") {
        if (!isSaisie && !isAdmin) return res.status(403).json({ success: false, error: "Seul le service Achats peut soumettre" });
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });

        const doc = await db_firestore.collection("caisse_transactions").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Transaction introuvable" });
        const current = doc.data();

        if (!["brouillon", "rejete"].includes(current.status)) return res.status(400).json({ success: false, error: "Seul un brouillon ou une transaction rejetée peut être soumis" });
        if (current.saisie_by?.uid !== authUser.uid && !isAdmin) return res.status(403).json({ success: false, error: "Vous ne pouvez soumettre que vos propres transactions" });

        const now = admin.firestore.FieldValue.serverTimestamp();
        await db_firestore.collection("caisse_transactions").doc(id).update({
          status: "soumis", soumis_par: userInfo, soumis_at: now, updated_at: now,
          history: [...(current.history || []), { action: "soumission", by: userInfo, at: Date.now() }],
        });
        return res.json({ success: true });
      }

      // ========== VALIDATE TRANSACTION ==========
      if (action === "validate-transaction" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut valider" });
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });

        // Atomic: update status + update caisse balance
        await db_firestore.runTransaction(async (t) => {
          const txRef = db_firestore.collection("caisse_transactions").doc(id);
          const txDoc = await t.get(txRef);
          if (!txDoc.exists) throw new Error("Transaction introuvable");
          const txData = txDoc.data();
          if (txData.status !== "soumis") throw new Error("Seule une transaction soumise peut être validée");

          const caisseRef = db_firestore.collection("caisse_definitions").doc(txData.caisse_id);
          const caisseDoc = await t.get(caisseRef);
          if (!caisseDoc.exists) throw new Error("Caisse introuvable");

          // Calculate balance change — formule partagée avec update-transaction
          // (dévalidation), cf. functions/lib/caisse/soldeDelta.js
          const delta = computeSoldeDelta({ type: txData.type, montant: txData.montant });

          const newSolde = Math.round(((caisseDoc.data().solde_actuel || 0) + delta) * 100) / 100;

          t.update(txRef, {
            status: "valide", valide_par: userInfo, valide_at: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
            history: [...(txData.history || []), { action: "validation", by: userInfo, at: Date.now() }],
          });
          t.update(caisseRef, { solde_actuel: newSolde, updated_at: admin.firestore.FieldValue.serverTimestamp() });
        });

        return res.json({ success: true });
      }

      // ========== REJECT TRANSACTION ==========
      if (action === "reject-transaction" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut rejeter" });
        const { id, motif } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        if (!motif) return res.status(400).json({ success: false, error: "Motif de rejet requis" });

        const doc = await db_firestore.collection("caisse_transactions").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Transaction introuvable" });
        const current = doc.data();
        if (current.status !== "soumis") return res.status(400).json({ success: false, error: "Seule une transaction soumise peut être rejetée" });

        const now = admin.firestore.FieldValue.serverTimestamp();
        await db_firestore.collection("caisse_transactions").doc(id).update({
          status: "rejete", rejete_par: userInfo, rejete_at: now, motif_rejet: motif, updated_at: now,
          history: [...(current.history || []), { action: "rejet", by: userInfo, at: Date.now(), motif }],
        });
        return res.json({ success: true });
      }

      // ========== DELETE TRANSACTION ==========
      if (action === "delete-transaction" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });

        const doc = await db_firestore.collection("caisse_transactions").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Transaction introuvable" });
        const current = doc.data();

        if (current.status !== "brouillon") return res.status(400).json({ success: false, error: "Seul un brouillon peut être supprimé" });
        if (current.saisie_by?.uid !== authUser.uid && !isAdmin) return res.status(403).json({ success: false, error: "Vous ne pouvez supprimer que vos propres brouillons" });

        await db_firestore.collection("caisse_transactions").doc(id).delete();
        return res.json({ success: true });
      }

      // ========== CREATE TRANSFER ==========
      if (action === "create-transfer" && req.method === "POST") {
        if (!isSaisie && !isAdmin) return res.status(403).json({ success: false, error: "Seul le service Achats peut créer des transferts" });
        const { from_caisse_id, to_caisse_id, montant, description, date, submit } = req.body;
        if (!from_caisse_id || !to_caisse_id || !montant || !date) return res.status(400).json({ success: false, error: "from_caisse_id, to_caisse_id, montant et date requis" });
        if (from_caisse_id === to_caisse_id) return res.status(400).json({ success: false, error: "La caisse source et destination doivent être différentes" });
        if (montant <= 0) return res.status(400).json({ success: false, error: "Le montant doit être positif" });

        // Verify both caisses exist
        const [fromDoc, toDoc] = await Promise.all([
          db_firestore.collection("caisse_definitions").doc(from_caisse_id).get(),
          db_firestore.collection("caisse_definitions").doc(to_caisse_id).get(),
        ]);
        if (!fromDoc.exists || !fromDoc.data().active) return res.status(404).json({ success: false, error: "Caisse source introuvable" });
        if (!toDoc.exists || !toDoc.data().active) return res.status(404).json({ success: false, error: "Caisse destination introuvable" });

        const transferId = `TRF-${Date.now().toString(36).toUpperCase()}`;
        const refOut = `${transferId}-OUT`;
        const refIn = `${transferId}-IN`;
        const now = admin.firestore.FieldValue.serverTimestamp();
        const status = submit ? "soumis" : "brouillon";
        const historyBase = [{ action: "creation", by: userInfo, at: Date.now() }];
        if (submit) historyBase.push({ action: "soumission", by: userInfo, at: Date.now() });

        const batch = db_firestore.batch();

        const outRef = db_firestore.collection("caisse_transactions").doc();
        const inRef = db_firestore.collection("caisse_transactions").doc();

        batch.set(outRef, {
          caisse_id: from_caisse_id, type: "transfer_out", montant: parseFloat(montant),
          reference: refOut, description: description || `Transfert vers ${toDoc.data().nom}`,
          code_analytique: "", date, status,
          transfer_linked_id: inRef.id, transfer_caisse_dest: to_caisse_id,
          files: [], saisie_by: userInfo, created_at: now, updated_at: now,
          ...(submit ? { soumis_par: userInfo, soumis_at: now } : {}),
          history: [...historyBase],
        });

        batch.set(inRef, {
          caisse_id: to_caisse_id, type: "transfer_in", montant: parseFloat(montant),
          reference: refIn, description: description || `Transfert depuis ${fromDoc.data().nom}`,
          code_analytique: "", date, status,
          transfer_linked_id: outRef.id, transfer_caisse_dest: from_caisse_id,
          files: [], saisie_by: userInfo, created_at: now, updated_at: now,
          ...(submit ? { soumis_par: userInfo, soumis_at: now } : {}),
          history: [...historyBase],
        });

        await batch.commit();
        return res.json({ success: true, transferId, outId: outRef.id, inId: inRef.id });
      }

      // ========== WEEKLY REPORT ==========
      if (action === "weekly-report") {
        const weekStart = req.query.week_start; // YYYY-MM-DD (Saturday)
        if (!weekStart) return res.status(400).json({ success: false, error: "week_start (YYYY-MM-DD) requis" });

        // Calculate week end (Friday)
        const startDate = new Date(weekStart);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        const weekEnd = endDate.toISOString().slice(0, 10);

        // Get all caisses
        const caissesSnap = await db_firestore.collection("caisse_definitions").where("active", "==", true).get();
        const caisses = caissesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Get all validated transactions in the week
        const txSnap = await db_firestore.collection("caisse_transactions")
          .where("status", "==", "valide")
          .where("date", ">=", weekStart)
          .where("date", "<=", weekEnd)
          .get();
        const transactions = txSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Get all validated transactions before the week (for opening balance calculation)
        const beforeTxSnap = await db_firestore.collection("caisse_transactions")
          .where("status", "==", "valide")
          .where("date", "<", weekStart)
          .get();

        // Build report per caisse
        const report = caisses.map(c => {
          // Opening balance: initial + all transactions before week
          let soldeOuverture = c.solde_initial || 0;
          beforeTxSnap.docs.forEach(d => {
            const tx = d.data();
            if (tx.caisse_id !== c.id) return;
            if (tx.type === "alimentation" || tx.type === "transfer_in") soldeOuverture += (tx.montant || 0);
            else if (tx.type === "depense" || tx.type === "sortie" || tx.type === "transfer_out") soldeOuverture -= (tx.montant || 0);
          });

          const caisseTx = transactions.filter(tx => tx.caisse_id === c.id);
          let alimentations = 0, depenses = 0, sorties = 0, transfersIn = 0, transfersOut = 0;
          caisseTx.forEach(tx => {
            if (tx.type === "alimentation") alimentations += (tx.montant || 0);
            if (tx.type === "depense") depenses += (tx.montant || 0);
            if (tx.type === "sortie") sorties += (tx.montant || 0);
            if (tx.type === "transfer_in") transfersIn += (tx.montant || 0);
            if (tx.type === "transfer_out") transfersOut += (tx.montant || 0);
          });

          const soldeCloture = soldeOuverture + alimentations + transfersIn - depenses - sorties - transfersOut;

          return {
            caisse_id: c.id, nom: c.nom,
            solde_ouverture: soldeOuverture, solde_cloture: soldeCloture,
            alimentations, depenses, sorties, transfers_in: transfersIn, transfers_out: transfersOut,
            nb_transactions: caisseTx.length, transactions: caisseTx,
          };
        });

        return res.json({ success: true, weekStart, weekEnd, report });
      }

      // ========== IMPORT FROM EXCEL FILE ==========
      // Authenticated users (Achats/DG/Finance) can upload an Excel and have it parsed + imported.
      // Format is determined by caisse_id (each caisse has its own template).
      if (action === "import-excel-file" && req.method === "POST") {
        const { caisse_id, file_base64, format: requestedFormat, force_overwrite, dry_run } = req.body;
        if (!caisse_id) return res.status(400).json({ success: false, error: "caisse_id requis" });
        if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });

        const CAISSE_FORMATS = {
          caisse_depenses: "depenses_monthly",
          caisse_paie: "paie_recap",
          caisse_depenses_bahia: "bahia_single",
        };
        const format = requestedFormat || CAISSE_FORMATS[caisse_id];
        if (!format) return res.status(400).json({ success: false, error: `Aucun format Excel défini pour ${caisse_id}` });

        const XLSX = require("xlsx");
        let buffer;
        try {
          const b64 = file_base64.replace(/^data:[^;]+;base64,/, "");
          buffer = Buffer.from(b64, "base64");
        } catch (e) {
          return res.status(400).json({ success: false, error: "file_base64 invalide" });
        }

        const wb = XLSX.read(buffer, { type: "buffer" });

        let parsed;
        try {
          parsed = caisseImport.parseWorkbook(wb, { caisse_id, format, XLSX });
        } catch (parseErr) {
          console.error("Erreur parsing Excel:", parseErr);
          return res.status(400).json({ success: false, error: "Erreur parsing Excel: " + parseErr.message });
        }
        const { transactions, resetSoldeInitial, perSheet, warnings, ignoredSheets } = parsed;

        if (transactions.length === 0) {
          return res.json({ success: false, error: "Aucune transaction trouvée dans le fichier" });
        }

        const caisseRef = db_firestore.collection("caisse_definitions").doc(caisse_id);
        const caisseDoc = await caisseRef.get();
        if (!caisseDoc.exists) return res.status(404).json({ success: false, error: "Caisse introuvable: " + caisse_id });

        // --- Mode DRY-RUN : prévisualisation sans écriture ---
        // Réutilise STRICTEMENT le même parsing que l'import réel. Aucune écriture Firestore.
        if (dry_run) {
          const soldeInitialActuel = caisseDoc.data().solde_initial || 0;
          // totaux actuels (tx validées existantes)
          const curSnap = await db_firestore.collection("caisse_transactions")
            .where("caisse_id", "==", caisse_id).where("status", "==", "valide").get();
          let totalInActuel = 0, totalOutActuel = 0;
          curSnap.docs.forEach(d => {
            const tx = d.data();
            if (tx.type === "alimentation" || tx.type === "transfer_in") totalInActuel += (tx.montant || 0);
            else if (tx.type === "depense" || tx.type === "sortie" || tx.type === "transfer_out") totalOutActuel += (tx.montant || 0);
          });
          // détecter les external_id déjà présents (lecture seule, par lots de 400)
          const existingIds = new Set();
          for (let i = 0; i < transactions.length; i += 400) {
            const slice = transactions.slice(i, i + 400);
            const refs = slice.map(tx => db_firestore.collection("caisse_transactions").doc(tx.external_id));
            const docs = await Promise.all(refs.map(r => r.get()));
            docs.forEach((d, idx) => { if (d.exists) existingIds.add(slice[idx].external_id); });
          }
          const summary = caisseImport.buildDrySummary(
            { transactions, perSheet, warnings, ignoredSheets, resetSoldeInitial, format },
            { caisse_id, soldeInitialActuel, totalInActuel, totalOutActuel, existingIds, force_overwrite: !!force_overwrite }
          );
          return res.json(summary);
        }

        if (typeof resetSoldeInitial === "number") {
          await caisseRef.update({ solde_initial: resetSoldeInitial, updated_at: admin.firestore.FieldValue.serverTimestamp() });
        }

        let imported = 0, skipped = 0;
        const BATCH_SIZE = 400;
        for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
          const slice = transactions.slice(i, i + BATCH_SIZE);
          const refs = slice.map(tx => db_firestore.collection("caisse_transactions").doc(tx.external_id));
          const docs = await Promise.all(refs.map(r => r.get()));
          const batch = db_firestore.batch();
          slice.forEach((tx, idx) => {
            if (docs[idx].exists && !force_overwrite) { skipped++; return; }
            const now = Date.now();
            batch.set(refs[idx], {
              caisse_id: tx.caisse_id, type: tx.type, montant: tx.montant,
              reference: tx.reference || "", description: tx.description || "",
              code_analytique: tx.code_analytique || "", fournisseur: tx.fournisseur || "",
              date: tx.date, status: "valide", files: [],
              saisie_by: userInfo, soumis_par: userInfo, valide_par: userInfo,
              soumis_at: admin.firestore.FieldValue.serverTimestamp(),
              valide_at: admin.firestore.FieldValue.serverTimestamp(),
              created_at: admin.firestore.FieldValue.serverTimestamp(),
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
              history: [
                { action: "import_excel", by: userInfo, at: now, source: tx._meta || {} },
                { action: "validation", by: userInfo, at: now },
              ],
              _import_meta: tx._meta || {},
            });
            imported++;
          });
          await batch.commit();
        }

        const allTxSnap = await db_firestore.collection("caisse_transactions")
          .where("caisse_id", "==", caisse_id).where("status", "==", "valide").get();
        let totalIn = 0, totalOut = 0;
        allTxSnap.docs.forEach(d => {
          const tx = d.data();
          if (tx.type === "alimentation" || tx.type === "transfer_in") totalIn += (tx.montant || 0);
          else if (tx.type === "depense" || tx.type === "sortie" || tx.type === "transfer_out") totalOut += (tx.montant || 0);
        });
        const updatedDoc = await caisseRef.get();
        const soldeInitial = updatedDoc.data().solde_initial || 0;
        const soldeActuel = soldeInitial + totalIn - totalOut;
        await caisseRef.update({ solde_actuel: soldeActuel, updated_at: admin.firestore.FieldValue.serverTimestamp() });

        return res.json({
          success: true, imported, skipped, parsed: transactions.length,
          total_transactions: allTxSnap.size,
          solde_initial: soldeInitial, solde_actuel: soldeActuel,
          total_in: totalIn, total_out: totalOut, format,
          per_sheet: perSheet.map(s => ({
            key: s.key, label: s.label, rows_parsed: s.rows_parsed,
            alimentations: s.alimentations, depenses: s.depenses,
            montant_in: s.montant_in, montant_out: s.montant_out, warnings: s.warnings.length,
          })),
          warnings, ignored_sheets: ignoredSheets,
        });
      }

      // ========== PARAMÈTRES DE LA CAISSE (fermes + codes analytiques) ==========
      // Doc unique caisse_parametres/default. Alimente les listes déroulantes
      // Ferme et Code analytique du bon de caisse : ce qui est configuré ici est
      // exactement ce qui est proposé à la saisie.
      //
      // Lecture ouverte à tout profil ayant accès à la caisse (le formulaire de
      // saisie en a besoin) ; écriture réservée à DG/Finance.
      if (action === "caisse-parametres-get") {
        const doc = await db_firestore.collection("caisse_parametres").doc("default").get();
        const params = caisseParametres.withDefaults(doc.exists ? doc.data() : null);
        // `seeded: false` = aucun doc en base, les valeurs renvoyées sont les
        // défauts. On n'écrit PAS ici : une lecture ne doit rien créer, et le
        // premier enregistrement depuis l'écran Paramètres fera foi.
        return res.json({ success: true, ...params, seeded: doc.exists });
      }

      if (action === "caisse-parametres-save" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut modifier les paramètres de la caisse" });
        const fermes = caisseParametres.normalizeListe(req.body.fermes);
        const codes = caisseParametres.normalizeListe(req.body.codes_analytiques);
        const errFermes = caisseParametres.validateListe("fermes", fermes);
        if (errFermes) return res.status(400).json({ success: false, error: errFermes });
        const errCodes = caisseParametres.validateListe("codes analytiques", codes);
        if (errCodes) return res.status(400).json({ success: false, error: errCodes });

        const now = admin.firestore.FieldValue.serverTimestamp();
        const payload = { fermes, codes_analytiques: codes, updated_at: now, updated_by: userInfo };

        // Parcelles FIGÉES : envoyées uniquement par le bouton « Rafraîchir » de
        // l'écran Paramètres. Absentes du corps = on ne touche pas à l'existant
        // (un simple enregistrement des fermes ne doit pas les effacer).
        // Rattachement caisse → entité. Absent du corps = inchangé.
        if (req.body.entites !== undefined) {
          payload.entites = caisseEntites.normalizeEntites(req.body.entites);
        }

        if (req.body.parcelles !== undefined) {
          const parcelles = caisseParametres.normalizeParcelles(req.body.parcelles);
          if (parcelles.length === 0) return res.status(400).json({ success: false, error: "Aucune parcelle exploitable reçue — rafraîchissement annulé." });
          payload.parcelles = parcelles;
          payload.parcelles_maj_at = Date.now();
        }

        await db_firestore.collection("caisse_parametres").doc("default").set(payload, { merge: true });
        const doc = await db_firestore.collection("caisse_parametres").doc("default").get();
        return res.json({ success: true, ...caisseParametres.withDefaults(doc.data()) });
      }

      // ========== CLIENTS MARCHÉ LOCAL (activation pour la campagne) ==========
      // Un client est « suivi » quand son document caisse_definitions
      // compte_client_<id> existe ET porte active === true : c'est déjà le
      // référentiel que consulte apply-encaissements. On expose ici de quoi le
      // gérer, au lieu de devoir passer par la console Firestore.
      if (action === "caisse-clients-list") {
        // Le RÉFÉRENTIEL des clients est `clients_marche_local`, alimenté depuis
        // l'écran Bons d'Apport — c'est là que le service Achats crée un client.
        // La caisse ne fait que décider LESQUELS sont suivis, via l'existence
        // d'un compte_client_<slug> actif dans caisse_definitions.
        const [refSnap, caissesSnap] = await Promise.all([
          db_firestore.collection("clients_marche_local").get(),
          db_firestore.collection("caisse_definitions").get(),
        ]);

        // Comptes de suivi existants, indexés par slug.
        const comptes = {};
        caissesSnap.docs.forEach(d => {
          if (d.id.indexOf(caisseEntites.COMPTE_CLIENT_PREFIX) !== 0) return;
          comptes[caisseEntites.clientIdDepuisCaisse(d.id)] = d.data();
        });

        // Référentiel : on écarte les archivés, et on déduplique par slug — un
        // même nom a parfois deux documents (doublon historique).
        const parSlug = {};
        refSnap.docs.forEach(d => {
          const data = d.data() || {};
          if (data.archived === true) return;
          const nom = String(data.nom || "").trim();
          if (!nom) return;
          const slug = caisseEntites.slugifyClient(nom);
          if (!slug || parSlug[slug]) return;
          parSlug[slug] = nom;
        });

        // Un compte de suivi dont le client a disparu du référentiel reste
        // listé : sinon on ne pourrait plus le désactiver.
        Object.keys(comptes).forEach(slug => {
          if (!parSlug[slug]) parSlug[slug] = (comptes[slug].nom && String(comptes[slug].nom).trim())
            || caisseEntites.nomClientDepuisId(caisseEntites.COMPTE_CLIENT_PREFIX + slug);
        });

        const clients = Object.keys(parSlug).map(slug => {
          const compte = comptes[slug];
          return {
            id: caisseEntites.COMPTE_CLIENT_PREFIX + slug,
            client_id: slug,
            nom: parSlug[slug],
            actif: !!compte && compte.active !== false,
            suivi: !!compte,
            solde_actuel: compte ? (Number(compte.solde_actuel) || 0) : 0,
          };
        }).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

        return res.json({ success: true, clients });
      }

      if (action === "caisse-client-save" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut gérer les clients du marché local" });
        const nomBrut = String(req.body.nom || "").trim();
        let clientId = String(req.body.client_id || "").trim();
        if (!clientId) {
          // Dérive l'identifiant du nom, comme le fait le canevas d'encaissements.
          clientId = nomBrut.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        }
        if (!clientId) return res.status(400).json({ success: false, error: "Nom de client requis" });
        if (nomBrut.length > 80) return res.status(400).json({ success: false, error: "Nom de client trop long (max 80 caractères)" });

        const docId = caisseEntites.COMPTE_CLIENT_PREFIX + clientId;
        const ref = db_firestore.collection("caisse_definitions").doc(docId);
        const existing = await ref.get();
        const now = admin.firestore.FieldValue.serverTimestamp();
        const actif = req.body.actif !== false;

        if (!existing.exists) {
          // Création : solde à 0. On NE crée jamais un client désactivé — ça
          // n'aurait aucun effet utile et polluerait le référentiel.
          if (!actif) return res.status(400).json({ success: false, error: "Un nouveau client est créé actif" });
          await ref.set({
            nom: nomBrut || caisseEntites.nomClientDepuisId(docId),
            description: "Compte client Marché Local",
            devise: "MAD", active: true, is_default: false,
            solde_initial: 0, solde_actuel: 0,
            kind: "compte_client_marche_local",
            created_by: userInfo, created_at: now, updated_at: now,
          });
        } else {
          const maj = { active: actif, updated_at: now, updated_by: userInfo };
          if (nomBrut) maj.nom = nomBrut;
          await ref.update(maj);
        }
        return res.json({ success: true, id: docId, client_id: clientId, actif });
      }

      // ========== SEED DEFAULT CAISSES ==========
      if (action === "seed-defaults" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Accès refusé" });
        const defaults = [
          { id: "caisse_paie", nom: "Caisse Paie", description: "Caisse pour les paiements salariaux" },
          { id: "caisse_depenses", nom: "Caisse Dépenses", description: "Caisse pour les dépenses courantes" },
          { id: "caisse_marche_local_f1", nom: "Caisse Marché Local F1", description: "Caisse du marché local Ferme 1" },
          { id: "caisse_marche_local_f5", nom: "Caisse Marché Local F5", description: "Caisse du marché local Ferme 5" },
        ];
        const now = admin.firestore.FieldValue.serverTimestamp();
        const batch = db_firestore.batch();
        for (const c of defaults) {
          const ref = db_firestore.collection("caisse_definitions").doc(c.id);
          const existing = await ref.get();
          if (!existing.exists) {
            batch.set(ref, {
              nom: c.nom, description: c.description, solde_initial: 0, solde_actuel: 0,
              devise: "MAD", is_default: true, active: true,
              created_by: userInfo, created_at: now, updated_at: now,
            });
          }
        }
        await batch.commit();
        return res.json({ success: true, message: "Caisses par défaut créées" });
      }

      // =============================================================
      // Sprint 2 — Batch actions for control workflow
      // =============================================================
      // Helper: chunk an array into pieces of <= 400 (Firestore batch limit = 500, margin 100)
      function _chunkIds(ids) {
        const out = [];
        for (let i = 0; i < ids.length; i += 400) out.push(ids.slice(i, i + 400));
        return out;
      }

      // Helper: build a history entry and persist a batch update on a list of tx ids.
      // Skips tx that don't exist or fail the optional pre-check.
      async function _applyBatchUpdate(ids, buildUpdate, opts) {
        opts = opts || {};
        let updated = 0, skipped = 0;
        const errors = [];
        const chunks = _chunkIds(ids);
        for (const chunkIds of chunks) {
          const refs = chunkIds.map(id => db_firestore.collection("caisse_transactions").doc(id));
          const snaps = await Promise.all(refs.map(r => r.get()));
          const wb = db_firestore.batch();
          let writes = 0;
          snaps.forEach((snap, i) => {
            if (!snap.exists) { skipped++; errors.push({ id: chunkIds[i], reason: "not_found" }); return; }
            const data = snap.data();
            if (opts.preCheck && !opts.preCheck(data)) { skipped++; errors.push({ id: chunkIds[i], reason: opts.preCheckReason || "pre_check_failed" }); return; }
            const updates = buildUpdate(data, chunkIds[i]);
            if (!updates) { skipped++; return; }
            wb.update(refs[i], updates);
            writes++;
            updated++;
          });
          if (writes > 0) await wb.commit();
        }
        return { updated, skipped, errors };
      }

      // ----- validate-transactions-batch -----
      // status → 'valide', valide_par, valide_at, history. DG/Finance only.
      //
      // Cette action DOIT mouvementer solde_actuel exactement comme la validation
      // unitaire (validate-transaction). Historiquement elle ne le faisait pas :
      // les bons passaient à 'valide' sans que la caisse bouge, le solde système
      // ne correspondait donc plus au solde physique, et une dévalidation
      // ultérieure (update-transaction) soustrayait un delta jamais ajouté.
      //
      // Chaque chunk est traité dans UNE transaction Firestore : les bons et les
      // soldes de caisse bougent ensemble, ou pas du tout.
      if (action === "validate-transactions-batch" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut valider" });
        const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
        if (!ids || ids.length === 0) return res.status(400).json({ success: false, error: "ids[] requis" });

        let updated = 0, skipped = 0;
        const errors = [];
        /** @type {Object<string, number>} solde par caisse après validation */
        const soldes = {};

        // Chunks de 300 : la transaction écrit 1 doc par bon + 1 par caisse
        // touchée, et Firestore plafonne à 500 écritures par transaction.
        const chunks = [];
        for (let i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));

        for (const chunkIds of chunks) {
          // Compteurs LOCAUX à la tentative : une transaction Firestore peut être
          // rejouée, les accumuler globalement compterait deux fois.
          let chunkUpdated = 0, chunkSkipped = 0;
          let chunkErrors = [];
          let chunkSoldes = {};

          await db_firestore.runTransaction(async (t) => {
            chunkUpdated = 0; chunkSkipped = 0; chunkErrors = []; chunkSoldes = {};
            const now = Date.now();
            const txRefs = chunkIds.map(id => db_firestore.collection("caisse_transactions").doc(id));
            const txSnaps = await t.getAll(...txRefs);

            // 1. Qui est validable, et de combien chaque caisse bouge.
            //    Logique pure et testée : functions/lib/caisse/batchValidation.js
            const byId = {};
            const plan = planBatchValidation(txSnaps.map((snap, i) => {
              const data = snap.exists ? snap.data() : null;
              if (data) byId[chunkIds[i]] = { ref: txRefs[i], data };
              return { id: chunkIds[i], data };
            }));
            chunkSkipped += plan.errors.length;
            chunkErrors.push(...plan.errors);

            const eligibles = plan.eligibles.map(id => ({ id, ref: byId[id].ref, data: byId[id].data }));
            const deltaParCaisse = plan.deltaParCaisse;
            if (eligibles.length === 0) return;

            // 2. Lire les caisses concernées (TOUTES les lectures avant les écritures).
            const caisseIds = Object.keys(deltaParCaisse);
            const caisseRefs = caisseIds.map(id => db_firestore.collection("caisse_definitions").doc(id));
            const caisseSnaps = await t.getAll(...caisseRefs);
            const caissesOk = {};
            caisseSnaps.forEach((snap, i) => { if (snap.exists) caissesOk[caisseIds[i]] = snap.data(); });

            const nowTs = admin.firestore.FieldValue.serverTimestamp();

            // 3. Écritures — un bon dont la caisse n'existe pas n'est PAS validé.
            for (const e of eligibles) {
              if (!caissesOk[e.data.caisse_id]) {
                chunkSkipped++;
                chunkErrors.push({ id: e.id, reason: "caisse_introuvable" });
                continue;
              }
              t.update(e.ref, {
                status: "valide",
                valide_par: userInfo,
                valide_at: nowTs,
                updated_at: nowTs,
                history: [...(e.data.history || []), { action: "batch_validate", by: userInfo, at: now }],
              });
              chunkUpdated++;
            }

            for (const caisseId of caisseIds) {
              const caisse = caissesOk[caisseId];
              if (!caisse) continue;
              const newSolde = applyDelta(caisse.solde_actuel, deltaParCaisse[caisseId]);
              t.update(db_firestore.collection("caisse_definitions").doc(caisseId), { solde_actuel: newSolde, updated_at: nowTs });
              chunkSoldes[caisseId] = newSolde;
            }
          });

          updated += chunkUpdated;
          skipped += chunkSkipped;
          errors.push(...chunkErrors);
          Object.assign(soldes, chunkSoldes);
        }

        return res.json({ success: true, count: updated, updated, skipped, errors, soldes });
      }

      // ----- mark-revoir-batch -----
      // status → 'a_revoir' (nouveau statut Sprint 2), history. DG/Finance only.
      if (action === "mark-revoir-batch" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut marquer à revoir" });
        const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
        const motif = (req.body.motif || "").toString();
        if (!ids || ids.length === 0) return res.status(400).json({ success: false, error: "ids[] requis" });
        const now = Date.now();
        const result = await _applyBatchUpdate(ids, (data) => ({
          status: "a_revoir",
          a_revoir_par: userInfo,
          a_revoir_at: admin.firestore.FieldValue.serverTimestamp(),
          a_revoir_motif: motif,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          history: [...(data.history || []), { action: "batch_mark_revoir", by: userInfo, at: now, motif }],
        }));
        return res.json({ success: true, count: result.updated, ...result });
      }

      // ----- reassign-analytique-batch -----
      // Set code_analytique on every targeted tx. DG/Finance only.
      if (action === "reassign-analytique-batch" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut réaffecter l'analytique" });
        const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
        const code = (req.body.code_analytique || "").toString().trim();
        if (!ids || ids.length === 0) return res.status(400).json({ success: false, error: "ids[] requis" });
        if (!code) return res.status(400).json({ success: false, error: "code_analytique requis" });
        const now = Date.now();
        const result = await _applyBatchUpdate(ids, (data) => ({
          code_analytique: code,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          history: [...(data.history || []), { action: "batch_reassign_analytique", by: userInfo, at: now, from: data.code_analytique || "", to: code }],
        }));
        return res.json({ success: true, count: result.updated, ...result });
      }

      // ----- accept-anomalies-batch -----
      // Mark anomalies as accepted (visible in UI as ℹ instead of 🚩). No status change.
      // Accessible aussi à Achats (les saisies peuvent reconnaître leurs propres anomalies).
      if (action === "accept-anomalies-batch" && req.method === "POST") {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
        if (!ids || ids.length === 0) return res.status(400).json({ success: false, error: "ids[] requis" });
        const now = Date.now();
        const result = await _applyBatchUpdate(ids, (data) => ({
          anomalies_acceptees_par: userInfo,
          anomalies_acceptees_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          history: [...(data.history || []), { action: "batch_accept_anomalies", by: userInfo, at: now }],
        }));
        return res.json({ success: true, count: result.updated, ...result });
      }

      // =============================================================
      // Sprint 3 — Rapprochement mensuel + Avances
      // =============================================================

      // Helpers locaux
      function _periodeBounds(mois, annee) {
        // mois 1-12, annee 4 digits → bornes ISO YYYY-MM-DD inclusives
        const m = parseInt(mois, 10);
        const y = parseInt(annee, 10);
        if (!Number.isFinite(m) || m < 1 || m > 12) return null;
        if (!Number.isFinite(y) || y < 2000 || y > 2100) return null;
        const mm = String(m).padStart(2, "0");
        const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month
        return {
          from: `${y}-${mm}-01`,
          to:   `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
          docId: `${y}-${mm}`,
        };
      }

      async function _computeRapprochementTotals(caisseId, mois, annee) {
        const b = _periodeBounds(mois, annee);
        if (!b) return null;
        // Both queries wrapped in try/catch: when a required composite index
        // is still building, return a "degraded" result with totals=0 +
        // degraded flag so the UI can show a meaningful message instead of
        // crashing with a 500.
        let degraded = false;
        // Solde initial = somme des tx valide < from
        let soldeInitial = 0;
        try {
          const beforeSnap = await db_firestore.collection("caisse_transactions")
            .where("caisse_id", "==", caisseId)
            .where("status", "==", "valide")
            .where("date", "<", b.from)
            .get();
          beforeSnap.docs.forEach(d => {
            const t = d.data();
            const m = Number(t.montant) || 0;
            if (t.type === "alimentation" || t.type === "transfer_in") soldeInitial += m;
            else if (t.type === "depense" || t.type === "sortie" || t.type === "transfer_out") soldeInitial -= m;
          });
        } catch (e) {
          console.warn("[rapprochement] solde-initial query failed (likely index building):", e.message);
          degraded = true;
        }
        // Période : valide ET en attente (pour pouvoir lister les bloquants)
        let totalRecettes = 0, totalDepenses = 0;
        const blocking = []; // tx avec status != valide
        try {
          const periodSnap = await db_firestore.collection("caisse_transactions")
            .where("caisse_id", "==", caisseId)
            .where("date", ">=", b.from)
            .where("date", "<=", b.to)
            .get();
          periodSnap.docs.forEach(d => {
            const t = d.data();
            const m = Number(t.montant) || 0;
            if (t.status !== "valide") {
              blocking.push({ id: d.id, reference: t.reference || "", description: t.description || "", date: t.date || "", status: t.status || "", montant: m, type: t.type });
              return;
            }
            if (t.type === "alimentation" || t.type === "transfer_in") totalRecettes += m;
            else if (t.type === "depense" || t.type === "sortie" || t.type === "transfer_out") totalDepenses += m;
          });
        } catch (e) {
          console.warn("[rapprochement] period query failed (likely index building):", e.message);
          degraded = true;
        }
        const soldeTheorique = soldeInitial + totalRecettes - totalDepenses;
        return {
          periode: b,
          degraded,
          solde_initial: Number(soldeInitial.toFixed(2)),
          total_recettes: Number(totalRecettes.toFixed(2)),
          total_depenses: Number(totalDepenses.toFixed(2)),
          solde_theorique: Number(soldeTheorique.toFixed(2)),
          blocking_count: blocking.length,
          blocking_transactions: blocking,
        };
      }

      // ---- rapprochement-get (GET) ----
      if (action === "rapprochement-get") {
        const caisseId = req.query.caisse_id;
        const mois = req.query.mois;
        const annee = req.query.annee;
        if (!caisseId || !mois || !annee) return res.status(400).json({ success: false, error: "caisse_id + mois + annee requis" });
        const totals = await _computeRapprochementTotals(caisseId, mois, annee);
        if (!totals) return res.status(400).json({ success: false, error: "mois/annee invalides" });
        // Lit le doc rapprochement existant si présent
        const docId = `${caisseId}_${totals.periode.docId}`;
        const doc = await db_firestore.collection("caisse_rapprochements").doc(docId).get();
        const saved = doc.exists ? doc.data() : null;
        return res.json({
          success: true,
          caisse_id: caisseId,
          mois: parseInt(mois, 10),
          annee: parseInt(annee, 10),
          periode: totals.periode,
          totals: {
            solde_initial: totals.solde_initial,
            total_recettes: totals.total_recettes,
            total_depenses: totals.total_depenses,
            solde_theorique: totals.solde_theorique,
          },
          blocking_count: totals.blocking_count,
          blocking_transactions: totals.blocking_transactions,
          rapprochement: saved, // null si pas encore saisi
        });
      }

      // ---- rapprochement-save (POST) ----
      // Sauvegarde solde_physique + commentaire, statut reste 'ouvert'.
      if (action === "rapprochement-save" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut éditer un rapprochement" });
        const { caisse_id, mois, annee, solde_physique, commentaire } = req.body;
        if (!caisse_id || !mois || !annee || solde_physique === undefined) return res.status(400).json({ success: false, error: "caisse_id + mois + annee + solde_physique requis" });
        const totals = await _computeRapprochementTotals(caisse_id, mois, annee);
        if (!totals) return res.status(400).json({ success: false, error: "mois/annee invalides" });
        const sp = Number(solde_physique);
        if (!Number.isFinite(sp)) return res.status(400).json({ success: false, error: "solde_physique doit être un nombre" });
        const ecart = Number((sp - totals.solde_theorique).toFixed(2));
        if (Math.abs(ecart) > 0.005 && (!commentaire || !String(commentaire).trim())) {
          return res.status(400).json({ success: false, error: "Commentaire obligatoire si écart != 0" });
        }
        const docId = `${caisse_id}_${totals.periode.docId}`;
        const ref = db_firestore.collection("caisse_rapprochements").doc(docId);
        const existing = await ref.get();
        if (existing.exists && existing.data().statut === "cloture") {
          return res.status(400).json({ success: false, error: "Rapprochement déjà clôturé" });
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        const payload = {
          caisse_id, periode: { mois: parseInt(mois, 10), annee: parseInt(annee, 10) },
          solde_initial: totals.solde_initial,
          total_recettes: totals.total_recettes,
          total_depenses: totals.total_depenses,
          solde_theorique: totals.solde_theorique,
          solde_physique: sp,
          ecart,
          commentaire: String(commentaire || "").trim(),
          statut: "ouvert",
          updated_at: now,
          updated_by: userInfo,
          ...(existing.exists ? {} : { created_at: now, created_by: userInfo }),
        };
        await ref.set(payload, { merge: true });
        return res.json({ success: true, id: docId, rapprochement: payload });
      }

      // ---- rapprochement-cloture (POST) ----
      // Bloque si transactions non-validées dans la période.
      if (action === "rapprochement-cloture" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut clôturer un rapprochement" });
        const { caisse_id, mois, annee } = req.body;
        if (!caisse_id || !mois || !annee) return res.status(400).json({ success: false, error: "caisse_id + mois + annee requis" });
        const totals = await _computeRapprochementTotals(caisse_id, mois, annee);
        if (!totals) return res.status(400).json({ success: false, error: "mois/annee invalides" });
        if (totals.blocking_count > 0) {
          return res.status(400).json({
            success: false,
            error: `Impossible de clôturer : ${totals.blocking_count} transaction(s) non validées dans la période.`,
            blocking_count: totals.blocking_count,
            blocking_transactions: totals.blocking_transactions,
          });
        }
        const docId = `${caisse_id}_${totals.periode.docId}`;
        const ref = db_firestore.collection("caisse_rapprochements").doc(docId);
        const existing = await ref.get();
        if (!existing.exists) return res.status(400).json({ success: false, error: "Rapprochement non saisi (solde physique manquant) — sauvegardez d'abord." });
        const data = existing.data();
        if (data.statut === "cloture") return res.status(400).json({ success: false, error: "Déjà clôturé" });
        if (Math.abs(Number(data.ecart) || 0) > 0.005 && (!data.commentaire || !String(data.commentaire).trim())) {
          return res.status(400).json({ success: false, error: "Commentaire obligatoire si écart != 0" });
        }
        await ref.update({
          statut: "cloture",
          cloture_par: userInfo,
          cloture_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true, id: docId });
      }

      // ---- rapprochement-list (GET, optional) ----
      // Liste des rapprochements existants, triés DESC par période.
      if (action === "rapprochement-list") {
        const caisseId = req.query.caisse_id;
        let q = db_firestore.collection("caisse_rapprochements");
        if (caisseId) q = q.where("caisse_id", "==", caisseId);
        const snap = await q.get();
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        items.sort((a, b) => {
          const ka = (a.periode && (a.periode.annee * 100 + a.periode.mois)) || 0;
          const kb = (b.periode && (b.periode.annee * 100 + b.periode.mois)) || 0;
          return kb - ka;
        });
        return res.json({ success: true, items });
      }

      // ---- avances-liste (GET) ----
      // Retourne la liste des transactions d'avance pour aggregateAvances côté client.
      // Filtres : caisse_id (optional), status=valide, type=depense, description match avance keyword.
      if (action === "avances-liste") {
        const caisseId = req.query.caisse_id;
        let q = db_firestore.collection("caisse_transactions")
          .where("status", "==", "valide")
          .where("type", "==", "depense");
        if (caisseId) q = q.where("caisse_id", "==", caisseId);
        const snap = await q.get();
        const transactions = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id, ...data,
            created_at: data.created_at && data.created_at.toMillis ? data.created_at.toMillis() : data.created_at,
            updated_at: data.updated_at && data.updated_at.toMillis ? data.updated_at.toMillis() : data.updated_at,
          };
        }).filter(t => {
          const d = (t.description || "").trim();
          return /^(avances?|acomptes?)\b/i.test(d);
        });
        return res.json({ success: true, transactions });
      }

      // ---- avance-regulariser (POST) ----
      // Ajoute une entrée dans regularisations[] sur la tx d'avance.
      if (action === "avance-regulariser" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut régulariser une avance" });
        const { tx_id, montant, ref: regRef, commentaire } = req.body;
        if (!tx_id) return res.status(400).json({ success: false, error: "tx_id requis" });
        const m = Number(montant);
        if (!Number.isFinite(m) || m <= 0) return res.status(400).json({ success: false, error: "montant > 0 requis" });
        const ref = db_firestore.collection("caisse_transactions").doc(tx_id);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Transaction introuvable" });
        const data = doc.data();
        if (data.type !== "depense" || data.status !== "valide") {
          return res.status(400).json({ success: false, error: "La transaction doit être une dépense validée." });
        }
        const regs = Array.isArray(data.regularisations) ? data.regularisations.slice() : [];
        const sumExisting = regs.reduce((s, r) => s + (Number(r && r.montant) || 0), 0);
        const restant = (Number(data.montant) || 0) - sumExisting;
        if (m > restant + 0.005) {
          return res.status(400).json({ success: false, error: `Montant dépasse le solde dû (${restant.toFixed(2)} DH restant).` });
        }
        const now = Date.now();
        const newReg = {
          montant: Number(m.toFixed(2)),
          ref: String(regRef || "").trim(),
          commentaire: String(commentaire || "").trim(),
          regularise_par: userInfo,
          regularise_at: now,
        };
        regs.push(newReg);
        await ref.update({
          regularisations: regs,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          history: [...(data.history || []), { action: "regularisation_avance", by: userInfo, at: now, montant: newReg.montant, ref: newReg.ref }],
        });
        return res.json({ success: true, regularisation: newReg, total_regularise: sumExisting + newReg.montant, solde_du: restant - newReg.montant });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur caisseManagement:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// PRIMES FIXES — gestion gated (RH/DG) du registre ouvrier (prime de fonction)
// =============================================
//
// SÉCURITÉ CRITIQUE : écriture de PAIE. Toutes les écritures vers
// ouvriers_registry passent EXCLUSIVEMENT par cette Cloud Function. Le rôle
// est résolu côté SERVEUR (resolveCallerRole + users/{uid}.role), jamais
// depuis le body. Seuls profileId ∈ {rh, dg} OU role système 'admin' sont
// autorisés ; tout autre profil (caporal, chef, magasinier...) reçoit 403
// AVANT toute lecture/écriture.
//
// Sémantique effectiveFrom + historisation : cf. functions/lib/primes/*.
