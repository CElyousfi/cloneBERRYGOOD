/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { COLLECTION, USE_MIRROR, admin, bucket, db_firestore, demandeCreationArticle, dispatchNotification, functions, getConsommationRows, getPool, getSyncStatus, requireAuth, setCors, sqlConfig, syncService, verifyAuth, whatsappService, withCache } = require("../../shared/core");

const { validateBugReport } = require("../../../lib/bugReports/validateBugReport");
const { isAdminProfile, validateStatusUpdate, sortReportsByCreatedDesc, isValidStatus, isFilterableStatus } = require("../../../lib/bugReports/bugStatus");
const bugTriage = require("../../../lib/triage/bugTriage");
exports.sqlToFirestoreSync = syncService.sqlToFirestoreSync;
exports.sqlSyncTrigger = syncService.sqlSyncTrigger;
const bdpIntrospectService = require("../../../bdpIntrospectService");

// P2b — pull pointage FACTUEL BDP → collection témoin (zéro écriture live)
const backupService = require("../../../backupService");
exports.scheduledBackup = backupService.scheduledBackup;
exports.backupApi = backupService.backupApi;

// SQL — lazy-loaded to avoid loading mssql when USE_MIRROR=true
exports.dashboard = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "512MB", minInstances: 1 })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      if (!USE_MIRROR) {
        const result = await withCache("dashboard", 30 * 60 * 1000, async () => {
          const db = await getPool();
          const [topEngrais, topPesticides, mensuel] = await Promise.all([
            db.request().query(`SELECT TOP 20 Article, SUM(Quantite) AS Qty, Article_Categorie FROM BR_Consommation WHERE Article_Categorie = 'Engrais' AND [Date] >= '2025-07-01' GROUP BY Article, Article_Categorie ORDER BY SUM(Quantite) DESC`),
            db.request().query(`SELECT TOP 20 Article, SUM(Quantite) AS Qty, Article_Categorie FROM BR_Consommation WHERE Article_Categorie = 'Pesticides' AND [Date] >= '2025-07-01' GROUP BY Article, Article_Categorie ORDER BY SUM(Quantite) DESC`),
            db.request().query(`SELECT FORMAT([Date],'yyyy-MM') AS Mois, SUM(CASE WHEN Article_Categorie = 'Engrais' THEN Quantite ELSE 0 END) AS Engrais, SUM(CASE WHEN Article_Categorie = 'Pesticides' THEN Quantite ELSE 0 END) AS Pesticides FROM BR_Consommation WHERE [Date] >= '2025-07-01' GROUP BY FORMAT([Date],'yyyy-MM') ORDER BY FORMAT([Date],'yyyy-MM')`),
          ]);
          return { success: true, topEngrais: topEngrais.recordset, topPesticides: topPesticides.recordset, consommationMensuelle: mensuel.recordset, dateExtraction: new Date().toISOString() };
        });
        return res.json(result);
      }
      // Mirror path
      const rows = await getConsommationRows({});
      // Top 20 engrais
      const engAgg = {};
      rows.filter(r => r.Article_Categorie === "Engrais").forEach(r => {
        if (!engAgg[r.Article]) engAgg[r.Article] = { Article: r.Article, Qty: 0, Article_Categorie: r.Article_Categorie };
        engAgg[r.Article].Qty += r.Quantite || 0;
      });
      const topEngrais = Object.values(engAgg).sort((a, b) => b.Qty - a.Qty).slice(0, 20);
      // Top 20 pesticides
      const pestAgg = {};
      rows.filter(r => r.Article_Categorie === "Pesticides").forEach(r => {
        if (!pestAgg[r.Article]) pestAgg[r.Article] = { Article: r.Article, Qty: 0, Article_Categorie: r.Article_Categorie };
        pestAgg[r.Article].Qty += r.Quantite || 0;
      });
      const topPesticides = Object.values(pestAgg).sort((a, b) => b.Qty - a.Qty).slice(0, 20);
      // Monthly consumption
      const mensuelAgg = {};
      rows.forEach(r => {
        const mois = (r.Date || "").slice(0, 7);
        if (!mois) return;
        if (!mensuelAgg[mois]) mensuelAgg[mois] = { Mois: mois, Engrais: 0, Pesticides: 0 };
        if (r.Article_Categorie === "Engrais") mensuelAgg[mois].Engrais += r.Quantite || 0;
        if (r.Article_Categorie === "Pesticides") mensuelAgg[mois].Pesticides += r.Quantite || 0;
      });
      const consommationMensuelle = Object.values(mensuelAgg).sort((a, b) => a.Mois.localeCompare(b.Mois));
      const syncStatus = await getSyncStatus();
      res.json({ success: true, topEngrais, topPesticides, consommationMensuelle, dateExtraction: new Date().toISOString(), syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null });
    } catch (err) {
      console.error("Erreur dashboard:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API 5: Agro Summary — NPK par parcelle depuis SQL
// =============================================
// Table de composition NPK des engrais (% de matière active)
// Lookup case-insensitive pour matcher les noms SQL
exports.health = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    try {
      // Default health check: Firestore ping (no SQL hit)
      const needsSQL = req.query.mode === "sql";
      if (!needsSQL) {
        const syncStatus = await getSyncStatus();
        // Fraîcheur de la DONNÉE source de pointage (âge de MAX(Periode_Date)),
        // distincte du dataAge du RUN de sync (qui réussit même sur source gelée).
        const pointageFreshness = await syncService.getPointageDataFreshness();
        return res.json({
          success: true,
          mode: "firestore",
          mirror: USE_MIRROR,
          syncStatus: syncStatus || {},
          pointageDataMaxDate: pointageFreshness.pointageDataMaxDate,
          pointageDataAgeHours: pointageFreshness.pointageDataAgeHours,
          pointageDataAgeDays: pointageFreshness.pointageDataAgeDays,
          pointageDataProbedAt: pointageFreshness.probedAt,
          timestamp: new Date().toISOString(),
        });
      }
      // SQL diagnostic mode — requires authentication
      const authUser = await requireAuth(req, res);
      if (!authUser) return;
      const db = await getPool();
      const result = await db.request().query("SELECT GETDATE() AS now, DB_NAME() AS db");
      res.json({
        success: true,
        server: sqlConfig.server,
        database: sqlConfig.database,
        serverTime: result.recordset[0].now,
        dbName: result.recordset[0].db,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Avancement Culture — CRUD Firestore
// =============================================
exports.uploadPhoto = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST uniquement" });
    try {
      const parcelle = req.query.parcelle || req.body.parcelle;
      if (!parcelle) return res.status(400).json({ success: false, error: "parcelle requise" });

      const { image, filename, date, note } = req.body;
      if (!image) return res.status(400).json({ success: false, error: "image (base64) requise" });

      // Décoder base64 et uploader dans Storage
      const docId = parcelle.replace(/\//g, '_SLASH_').replace(/\s+/g, ' ').trim();
      const safeStorageName = parcelle.replace(/\//g, '_').replace(/\s+/g, '_');
      const buffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), "base64");
      const ext = (filename || "photo.jpg").split(".").pop() || "jpg";
      const storagePath = `avancement/${safeStorageName}/${Date.now()}.${ext}`;
      const file = bucket.file(storagePath);
      await file.save(buffer, { metadata: { contentType: `image/${ext}` } });
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

      // Enregistrer la référence dans Firestore
      const docRef = db_firestore.collection(COLLECTION).doc(docId);
      const doc = await docRef.get();
      const photos = (doc.exists && doc.data().photos) || [];
      photos.push({ url: publicUrl, date: date || new Date().toISOString().slice(0, 10), note: note || "", path: storagePath, uploadedAt: new Date().toISOString() });
      await docRef.set({ photos }, { merge: true });

      return res.json({ success: true, url: publicUrl, photosCount: photos.length });
    } catch (err) {
      console.error("Erreur upload photo:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Sentinel recipients — synchro destinataires WhatsApp pour bgf-sentinel
// Route: /api/sentinel-recipients (GET, auth par clé partagée x-sentinel-key)
// Renvoie strictement { ferme, whatsappPhone, profileId } — aucun PII.
// =============================================
exports.bugReports = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const action = req.query.action || (req.body && req.body.action);

    if (action === "submit-bug") {
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "POST uniquement" });
      }
      const authUser = await requireAuth(req, res);
      if (!authUser) return; // réponse 401 déjà envoyée

      try {
        const body = req.body || {};
        const check = validateBugReport(body);
        if (!check.valid) {
          return res.status(400).json({ success: false, error: check.error });
        }

        // Résoudre le reporter depuis Firestore (jamais depuis le body client).
        let reporterName = authUser.name || authUser.email || "";
        let profileId = null;
        try {
          const uSnap = await db_firestore.collection("users").doc(authUser.uid).get();
          if (uSnap.exists) {
            const u = uSnap.data() || {};
            reporterName = u.displayName || reporterName;
            profileId = u.profileId || null;
          }
        } catch (e) {
          console.warn("[bugReports] résolution user échouée:", e.message);
        }

        const device = (body.device && typeof body.device === "object") ? body.device : {};
        const screen = typeof body.screen === "string" ? body.screen.slice(0, 200) : "";

        // Pré-allouer l'ID du doc pour nommer le fichier Storage.
        const docRef = db_firestore.collection("bug_reports").doc();
        let photoUrl = null;

        if (check.hasPhoto) {
          // Même pattern que exports.uploadPhoto : décode base64 → buffer → file.save → URL publique.
          const raw = body.photoBase64;
          const matchExt = /^data:image\/(\w+);base64,/.exec(raw);
          const ext = matchExt ? matchExt[1] : "jpg";
          const buffer = Buffer.from(raw.replace(/^data:image\/\w+;base64,/, ""), "base64");
          const storagePath = `bug_reports/${docRef.id}/photo.${ext}`;
          const file = bucket.file(storagePath);
          await file.save(buffer, { metadata: { contentType: `image/${ext}` } });
          photoUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        }

        await docRef.set({
          photo_url: photoUrl,
          description: check.description,
          reporter: { uid: authUser.uid, name: reporterName, profileId: profileId },
          screen: screen,
          device: {
            userAgent: typeof device.userAgent === "string" ? device.userAgent.slice(0, 500) : "",
            viewport: typeof device.viewport === "string" ? device.viewport.slice(0, 40) : "",
          },
          status: "nouveau",
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Notifier Omar (DG) par WhatsApp — best-effort, ne bloque jamais la création.
        try {
          const dgRecipients = await whatsappService.resolveRecipientsForProfile("dg", null);
          const shortDesc = check.description.length > 280
            ? check.description.slice(0, 277) + "…"
            : check.description;
          const msg = "🐛 Nouveau signalement de bug\n"
            + "Par : " + (reporterName || "?") + (profileId ? " (" + profileId + ")" : "") + "\n"
            + "Écran : " + (screen || "?") + "\n"
            + "Description : " + shortDesc
            + (photoUrl ? "\n📎 Photo jointe" : "");
          await Promise.allSettled(
            dgRecipients.map((r) => whatsappService.sendTemplateMessage(r.phone, "general_alert", [whatsappService.toSingleLine(msg)]))
          );
        } catch (waErr) {
          console.warn("[bugReports] notif WhatsApp échouée:", waErr.message);
        }

        return res.json({ success: true, id: docRef.id });
      } catch (err) {
        console.error("Erreur bugReports submit-bug:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // --- Vue admin (Phase B) : list-bugs (GET) + update-bug-status (POST) ---
    // Réservées aux profils admin (dg / resp RH). Le rôle est résolu côté serveur
    // depuis users/{uid}.profileId (jamais depuis le body client), comme submit-bug.
    if (action === "list-bugs" || action === "update-bug-status") {
      const authUser = await requireAuth(req, res);
      if (!authUser) return; // 401 déjà envoyée

      // Résoudre le profil de l'appelant depuis Firestore et vérifier l'accès admin.
      let callerProfileId = null;
      let callerName = authUser.name || authUser.email || "";
      try {
        const uSnap = await db_firestore.collection("users").doc(authUser.uid).get();
        if (uSnap.exists) {
          const u = uSnap.data() || {};
          callerProfileId = u.profileId || null;
          callerName = u.displayName || callerName;
        }
      } catch (e) {
        console.warn("[bugReports] résolution profil appelant échouée:", e.message);
      }
      if (!isAdminProfile(callerProfileId)) {
        return res.status(403).json({ success: false, error: "Accès réservé aux administrateurs" });
      }

      if (action === "list-bugs") {
        if (req.method !== "GET") {
          return res.status(405).json({ success: false, error: "GET uniquement" });
        }
        try {
          const statusFilter = typeof req.query.status === "string" ? req.query.status : "";
          let query = db_firestore.collection("bug_reports");
          if (statusFilter && isFilterableStatus(statusFilter)) {
            query = query.where("status", "==", statusFilter);
          }
          const snap = await query.get();
          const bugs = [];
          snap.forEach((doc) => {
            const d = doc.data() || {};
            bugs.push({
              id: doc.id,
              photo_url: d.photo_url || null,
              description: d.description || "",
              reporter: d.reporter || null,
              screen: d.screen || "",
              device: d.device || null,
              status: d.status || "nouveau",
              // Champs posés par le triage IA (onBugReportCreate). Absents tant
              // que le doc n'est pas qualifié (status reste 'nouveau').
              severity: d.severity || null,
              module: d.module || null,
              summary: d.summary || null,
              suggestedAction: d.suggestedAction || null,
              isDuplicate: typeof d.isDuplicate === "boolean" ? d.isDuplicate : null,
              duplicateOf: d.duplicateOf || null,
              triaged_at: d.triaged_at && typeof d.triaged_at.toMillis === "function" ? d.triaged_at.toMillis() : null,
              created_at: d.created_at ? d.created_at.toMillis() : null,
              updated_at: d.updated_at ? d.updated_at.toMillis() : null,
              history: Array.isArray(d.history) ? d.history.map((h) => ({
                action: h.action || null,
                from: h.from || null,
                to: h.to || null,
                by: h.by || null,
                at: h.at && typeof h.at.toMillis === "function" ? h.at.toMillis() : (h.at || null),
              })) : [],
            });
          });
          // Tri côté serveur (helper pur) — created_at desc.
          const sorted = sortReportsByCreatedDesc(bugs);
          return res.json({ success: true, bugs: sorted });
        } catch (err) {
          console.error("Erreur bugReports list-bugs:", err);
          return res.status(500).json({ success: false, error: err.message });
        }
      }

      // action === "update-bug-status"
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "POST uniquement" });
      }
      try {
        const check = validateStatusUpdate(req.body || {});
        if (!check.valid) {
          return res.status(400).json({ success: false, error: check.error });
        }
        const docRef = db_firestore.collection("bug_reports").doc(check.id);
        const by = { uid: authUser.uid, name: callerName, profileId: callerProfileId };
        // Transaction : lire l'ancien statut pour tracer la transition dans history.
        const result = await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          if (!snap.exists) {
            return { notFound: true };
          }
          const data = snap.data() || {};
          const from = data.status || "nouveau";
          const historyEntry = {
            action: "status_change",
            from: from,
            to: check.status,
            by: by,
            // serverTimestamp() interdit dans un élément de tableau → timestamp client (epoch ms).
            at: Date.now(),
          };
          tx.update(docRef, {
            status: check.status,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
            history: admin.firestore.FieldValue.arrayUnion(historyEntry),
          });
          return { notFound: false };
        });
        if (result.notFound) {
          return res.status(404).json({ success: false, error: "Signalement introuvable" });
        }
        return res.json({ success: true, id: check.id, status: check.status });
      } catch (err) {
        console.error("Erreur bugReports update-bug-status:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(400).json({ success: false, error: "Action inconnue ou méthode invalide" });
  });

/**
 * onBugReportCreate — trigger Firestore (fire-and-forget) qui qualifie
 * automatiquement un bug report via Claude (Sonnet), en async, sans bloquer la
 * soumission HTTP (exports.bugReports répond déjà au client).
 *
 * Flux :
 *  1. Lire le doc créé. Idempotence : on ne traite que status === 'nouveau'.
 *  2. Construire le contexte « BUGS RÉCENTS » (≤ 20 derniers docs 'qualified').
 *  3. Appeler Claude (tool_use forcé). 1 tentative + 1 retry court.
 *  4. Succès → update(severity, module, summary, suggestedAction, isDuplicate,
 *     duplicateOf, status:'qualified', triaged_at, triaged_model).
 *  5. severity critical|high → WhatsApp à Omar (DG) via whatsappService.
 *  6. Échec/timeout Claude → log 'triage_error', le doc reste 'nouveau'
 *     (aucune perte, l'archi le voit dans la vue admin).
 *
 * La clé API est injectée via Secret Manager (ANTHROPIC_API_KEY_TRIAGE),
 * jamais en clair dans le repo.
 */
exports.onBugReportCreate = functions
  .region("europe-west1")
  .runWith({ secrets: ["ANTHROPIC_API_KEY_TRIAGE"], timeoutSeconds: 120, memory: "512MB" })
  .firestore.document("bug_reports/{id}")
  .onCreate(async (snap, context) => {
    const data = snap.data() || {};

    // Idempotence : ne traiter qu'un doc fraîchement créé (status 'nouveau').
    // 'new' toléré comme alias historique.
    if (data.status !== "nouveau" && data.status !== "new") {
      return null;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY_TRIAGE;
    if (!apiKey) {
      console.error("[onBugReportCreate] triage_error: ANTHROPIC_API_KEY_TRIAGE manquant — doc reste 'nouveau'");
      return null;
    }

    try {
      // 1. Contexte « BUGS RÉCENTS » : derniers docs déjà qualifiés.
      let recentBugs = [];
      try {
        const recentSnap = await db_firestore
          .collection("bug_reports")
          .where("status", "==", "qualified")
          .orderBy("triaged_at", "desc")
          .limit(20)
          .get();
        recentSnap.forEach((doc) => {
          const rd = doc.data() || {};
          recentBugs.push({ id: doc.id, module: rd.module, summary: rd.summary });
        });
      } catch (ctxErr) {
        // Index manquant / collection vide → on continue sans contexte doublon.
        console.warn("[onBugReportCreate] contexte bugs récents indisponible:", ctxErr.message);
      }

      // 2. Construire les entrées Claude (helpers purs).
      const system = bugTriage.buildSystemPrompt(recentBugs);
      const userContent = bugTriage.buildUserContent(data);

      // 3. Appeler Claude (1 tentative + 1 retry court).
      const Anthropic = require("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: apiKey });

      let resp = null;
      try {
        resp = await bugTriage.callClaude(client, { system: system, userContent: userContent });
      } catch (firstErr) {
        console.warn("[onBugReportCreate] 1er appel Claude échoué, retry:", firstErr.message);
        await new Promise((r) => setTimeout(r, 1500));
        resp = await bugTriage.callClaude(client, { system: system, userContent: userContent });
      }

      const triage = bugTriage.parseTriage(resp);
      if (!triage) {
        console.error("[onBugReportCreate] triage_error: réponse Claude invalide (pas de tool_use exploitable) — doc reste 'nouveau'", snap.id);
        return null;
      }

      // 4. Persister le triage.
      await snap.ref.update({
        severity: triage.severity,
        module: triage.module,
        summary: triage.summary,
        suggestedAction: triage.suggestedAction,
        isDuplicate: triage.isDuplicate,
        duplicateOf: triage.duplicateOf,
        status: "qualified",
        triaged_at: admin.firestore.FieldValue.serverTimestamp(),
        triaged_model: bugTriage.TRIAGE_MODEL,
      });

      // 5. WhatsApp à Omar (DG) si critique ou important — best-effort.
      if (triage.severity === "critical" || triage.severity === "high") {
        try {
          const reporter = (data.reporter && data.reporter.name) || "?";
          const labelSev = triage.severity === "critical" ? "CRITIQUE" : "IMPORTANT";
          const refId = bugTriage.shortId(snap.id);
          const msg = "🔴 BUG " + labelSev + " — [" + triage.module + "] : " + triage.summary
            + ". Signalé par " + reporter + ". Réf #" + refId + ".";
          const dgRecipients = await whatsappService.resolveRecipientsForProfile("dg", null);
          await Promise.allSettled(
            dgRecipients.map((r) => whatsappService.sendTemplateMessage(r.phone, "general_alert", [whatsappService.toSingleLine(msg)]))
          );
        } catch (waErr) {
          console.warn("[onBugReportCreate] notif WhatsApp échouée:", waErr.message);
        }
      }

      return null;
    } catch (err) {
      // Échec global (Claude down/timeout après retry, etc.) : on NE change pas
      // le status (reste 'nouveau'), aucune perte. L'archi le voit en vue admin.
      console.error("[onBugReportCreate] triage_error:", err.message, "— doc", snap.id, "reste 'nouveau'");
      return null;
    }
  });

/**
 * onBugReportUpdate — trigger Firestore (best-effort) qui notifie le REPORTER
 * d'un bug report quand son signalement passe en statut 'resolved'.
 *
 * Idempotence : on ne déclenche QUE sur la transition `!== resolved -> resolved`
 * (cf. bugTriage.shouldNotifyResolved). Pas de re-notif si déjà 'resolved',
 * pas de notif sur les autres updates (triage 'qualified', etc.).
 *
 * Résolution du canal :
 *  1. Téléphone WhatsApp du reporter lu dans users/{reporter.uid}.whatsappPhone,
 *     en respectant whatsappEnabled (même contrat que resolveRecipientsForProfile).
 *  2. Si numéro présent ET WhatsApp activé → whatsappService.sendTextMessage.
 *  3. Sinon → pas de mécanisme in-app uid-scoppé disponible (le panneau lit
 *     /api/notifications, calculé dynamiquement par PROFIL depuis les collections
 *     métier, sans store générique par uid). On log un warning détaillé — à
 *     trancher avec l'archi (cf. RENDU).
 *
 * Best-effort : jamais de throw, on retourne toujours null.
 */
exports.onBugReportUpdate = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .firestore.document("bug_reports/{id}")
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};

    // Idempotence : uniquement la transition vers 'resolved'.
    if (!bugTriage.shouldNotifyResolved(before, after)) return null;

    const reporter = after.reporter || null;
    const reporterUid = reporter && reporter.uid;
    if (!reporterUid) {
      console.warn("[onBugReportUpdate] bug", context.params.id, "résolu mais reporter.uid manquant — notification impossible");
      return null;
    }

    const idCourt = bugTriage.shortId(context.params.id);
    const msg = bugTriage.buildResolvedMessage(after, idCourt);

    // Résoudre le téléphone WhatsApp du reporter depuis users/{uid}.
    let phone = null;
    let waEnabled = false;
    try {
      const uSnap = await db_firestore.collection("users").doc(reporterUid).get();
      if (uSnap.exists) {
        const u = uSnap.data() || {};
        // whatsappEnabled absent => on considère désactivé (opt-in), comme
        // resolveRecipientsForProfile qui filtre sur == true.
        waEnabled = u.whatsappEnabled === true && !u.disabled;
        if (waEnabled && u.whatsappPhone) {
          phone = whatsappService.formatPhoneE164(u.whatsappPhone);
        }
      }
    } catch (uErr) {
      console.warn("[onBugReportUpdate] lecture users/" + reporterUid + " échouée:", uErr.message);
    }

    // 1. Notifier le REPORTER (celui qui a signalé) — best-effort, jamais throw.
    if (phone) {
      try {
        await whatsappService.sendTemplateMessage(phone, "general_alert", [whatsappService.toSingleLine(msg)]);
      } catch (waErr) {
        console.warn("[onBugReportUpdate] notif WhatsApp reporter échouée:", waErr.message);
      }
    } else {
      // Pas de WhatsApp reporter (numéro absent ou désactivé) → pas de notif reporter.
      // Décision Omar (2026-06-12) : « WhatsApp seulement, pas de collection in-app ».
      // Le signalement reste consultable côté admin bugs.
      console.info(
        "[onBugReportUpdate] bug " + context.params.id + " résolu — reporter " + reporterUid +
        " sans WhatsApp activé : pas de notif reporter (décision WhatsApp-seul)."
      );
    }

    // 2. Notifier le DG (Omar) — résumé de résolution, SYMÉTRIQUE de la soumission
    //    (onBugReportCreate notifie déjà le DG à la création de chaque bug). Best-effort.
    //    Dédup : si le reporter EST le DG (même numéro), on n'envoie pas 2× le même bug.
    try {
      const dgMsg = bugTriage.buildResolvedDGMessage(after, idCourt);
      const dgRecipients = await whatsappService.resolveRecipientsForProfile("dg", null);
      const targets = (dgRecipients || []).filter((r) => r && r.phone && (!phone || r.phone !== phone));
      await Promise.all(targets.map((r) => whatsappService.sendTemplateMessage(r.phone, "general_alert", [whatsappService.toSingleLine(dgMsg)])));
    } catch (dgErr) {
      console.warn("[onBugReportUpdate] notif WhatsApp DG échouée:", dgErr.message);
    }

    return null;
  });

// =============================================
// API: Recommandation Claude AI
// =============================================
// Helper: Récupérer météo Open-Meteo (Agadir, Maroc — gratuit, sans clé)
exports.tasks = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const action = req.query.action;

      // ---- LIST all tasks ----
      if (action === "list") {
        const snap = await db_firestore.collection("tasks").orderBy("createdAt", "desc").get();
        const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, tasks });
      }

      // ---- MY TASKS (by assignedTo) ----
      if (action === "my-tasks") {
        const profile = req.query.profile;
        if (!profile) return res.status(400).json({ success: false, error: "profile requis" });
        const snap = await db_firestore.collection("tasks").where("assignedTo", "==", profile).get();
        const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, tasks });
      }

      // ---- CREATE task ----
      if (action === "create" && req.method === "POST") {
        const { title, description, assignedTo, assignedToName, priority, deadline, createdBy } = req.body;
        if (!title || !assignedTo || !deadline) return res.status(400).json({ success: false, error: "title, assignedTo, deadline requis" });
        const now = admin.firestore.FieldValue.serverTimestamp();
        const ref = await db_firestore.collection("tasks").add({
          title: title.trim(),
          description: (description || "").trim(),
          assignedTo,
          assignedToName: assignedToName || assignedTo,
          priority: priority || "moyenne",
          deadline,
          status: "a_faire",
          createdBy: createdBy || authUser.uid,
          sourceType: "manual",
          sourceCrId: null,
          sourceCrTitle: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        });
        return res.json({ success: true, id: ref.id });
      }

      // ---- UPDATE task ----
      if (action === "update" && req.method === "POST") {
        const { id, title, description, assignedTo, assignedToName, priority, deadline } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        await db_firestore.collection("tasks").doc(id).update({
          title: (title || "").trim(),
          description: (description || "").trim(),
          assignedTo,
          assignedToName: assignedToName || assignedTo,
          priority: priority || "moyenne",
          deadline,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true });
      }

      // ---- UPDATE STATUS ----
      if (action === "update-status" && req.method === "POST") {
        const { id, status } = req.body;
        if (!id || !status) return res.status(400).json({ success: false, error: "id, status requis" });
        const update = { status, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (status === "termine") update.completedAt = admin.firestore.FieldValue.serverTimestamp();
        await db_firestore.collection("tasks").doc(id).update(update);
        return res.json({ success: true });
      }

      // ---- DELETE task ----
      if (action === "delete" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        await db_firestore.collection("tasks").doc(id).delete();
        return res.json({ success: true });
      }

      // ---- FARM TODOS: list ----
      if (action === "farm-todos") {
        const snap = await db_firestore.collection("farm_todos").orderBy("createdAt", "desc").get();
        const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, todos });
      }

      // ---- FARM TODOS: add ----
      if (action === "farm-todo-add" && req.method === "POST") {
        const { farm, text } = req.body;
        if (!farm || !text) return res.status(400).json({ success: false, error: "farm, text requis" });
        await db_firestore.collection("farm_todos").add({
          farm, text: text.trim(), done: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true });
      }

      // ---- FARM TODOS: toggle done ----
      if (action === "farm-todo-toggle" && req.method === "POST") {
        const { id, done } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        await db_firestore.collection("farm_todos").doc(id).update({ done: !!done });
        return res.json({ success: true });
      }

      // ---- FARM TODOS: delete ----
      if (action === "farm-todo-delete" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        await db_firestore.collection("farm_todos").doc(id).delete();
        return res.json({ success: true });
      }

      // ---- FARM TODOS: edit ----
      if (action === "farm-todo-edit" && req.method === "POST") {
        const { id, text } = req.body;
        if (!id || !text) return res.status(400).json({ success: false, error: "id, text requis" });
        await db_firestore.collection("farm_todos").doc(id).update({ text: text.trim() });
        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur tasks API:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// ===================== MEETING CR API =====================
exports.meetingCR = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const action = req.query.action;

      // ---- LIST CRs ----
      if (action === "list") {
        const snap = await db_firestore.collection("meeting_crs").orderBy("date", "desc").get();
        const crs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Load linked tasks
        const taskSnap = await db_firestore.collection("tasks").where("sourceType", "==", "cr").get();
        const taskMap = {};
        taskSnap.docs.forEach(d => {
          const t = { id: d.id, ...d.data() };
          if (t.sourceCrId) {
            if (!taskMap[t.sourceCrId]) taskMap[t.sourceCrId] = [];
            taskMap[t.sourceCrId].push(t);
          }
        });
        return res.json({ success: true, crs, crTasks: taskMap });
      }

      // ---- SAVE CR (create or update) ----
      if (action === "save" && req.method === "POST") {
        const { id, title, date, participants, notes, actionItems, createdBy } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ success: false, error: "Titre requis" });
        if (!date) return res.status(400).json({ success: false, error: "Date requise" });

        const now = admin.firestore.FieldValue.serverTimestamp();
        const validActions = (actionItems || []).filter(a => a.title && a.title.trim() && a.assignedTo && a.deadline);

        if (id) {
          // UPDATE existing CR
          await db_firestore.collection("meeting_crs").doc(id).update({
            title: title.trim(), date, participants: participants || [], notes: (notes || "").trim(),
            actionItems: validActions, updatedAt: now,
          });
          return res.json({ success: true, id });
        } else {
          // CREATE new CR + tasks
          const batch = db_firestore.batch();
          const crRef = db_firestore.collection("meeting_crs").doc();
          const actionItemsWithIds = [];

          validActions.forEach(action => {
            const taskRef = db_firestore.collection("tasks").doc();
            batch.set(taskRef, {
              title: action.title.trim(),
              description: "",
              assignedTo: action.assignedTo,
              assignedToName: action.assignedToName || action.assignedTo,
              createdBy: createdBy || "system",
              status: "a_faire",
              priority: "moyenne",
              deadline: action.deadline,
              sourceType: "cr",
              sourceCrId: crRef.id,
              sourceCrTitle: title.trim(),
              createdAt: now, updatedAt: now, completedAt: null,
            });
            actionItemsWithIds.push({ ...action, taskId: taskRef.id });
          });

          batch.set(crRef, {
            title: title.trim(), date, participants: participants || [],
            notes: (notes || "").trim(), actionItems: actionItemsWithIds,
            createdBy: createdBy || "system",
            createdAt: now, updatedAt: now,
          });

          await batch.commit();
          return res.json({ success: true, id: crRef.id });
        }
      }

      // ---- DELETE CR ----
      if (action === "delete" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const batch = db_firestore.batch();
        batch.delete(db_firestore.collection("meeting_crs").doc(id));
        const taskSnap = await db_firestore.collection("tasks").where("sourceCrId", "==", id).get();
        taskSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur meetingCR:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Carburant — TotalEnergies fuel data
// =============================================
exports.notifications = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const profile = req.query.profile || "";
      const ferme = req.query.ferme || "";
      const today = new Date().toISOString().slice(0, 10);

      const categories = { validations: [], taches: [], alertes: [] };

      // ---- Helper: get dates for last 7 days ----
      const last7 = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        last7.push(d.toISOString().slice(0, 10));
      }

      // ---- COMMON: Tasks assigned to this profile ----
      const tasksPromise = db_firestore.collection("tasks")
        .where("assignedTo", "==", profile)
        .where("status", "in", ["a_faire", "en_cours"])
        .get();

      // ---- Profile-specific queries ----
      const promises = [tasksPromise];

      // RH: pointage_validations not fully validated (last 7 days)
      if (profile === "rh") {
        promises.push(
          db_firestore.collection("pointage_validations")
            .where("date", "in", last7).get()
            .then(snap => {
              const pending = snap.docs.filter(d => {
                const v = d.data();
                return !v.locked && !v.rejected;
              });
              if (pending.length > 0) {
                categories.validations.push({ key: "pointage_pending", label: "Pointages en attente de validation", count: pending.length, icon: "fa-clipboard-check", color: "#e67e22", tab: "pointage" });
              }
            })
        );
      }

      // Chef: BDC + pointage attente visa chef + demandes ré-exécution
      if (profile.startsWith("chef_")) {
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_chef")
            .where("ferme", "==", ferme)
            .get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_chef", label: "BDC à valider", count: snap.size, icon: "fa-file-contract", color: "#e67e22", tab: "chef_validations" });
            })
        );
        promises.push(
          db_firestore.collection("pointage_validations")
            .where("date", "in", last7).get()
            .then(snap => {
              const pending = snap.docs.filter(d => {
                const v = d.data();
                return v.ferme === ferme && v.visaCaporal && !v.visaChef && !v.locked;
              });
              if (pending.length > 0) categories.validations.push({ key: "pointage_chef", label: "Pointages attente visa Chef", count: pending.length, icon: "fa-clipboard-check", color: "#2c3e50", tab: "pointage" });
            })
        );
        promises.push(
          db_firestore.collection("suivi-hors-recolte-demandes")
            .where("ferme", "==", ferme)
            .where("statut", "==", "en_attente")
            .get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "demandes_reexec", label: "Demandes ré-exécution en attente", count: snap.size, icon: "fa-rotate", color: "#9b59b6", tab: "hors_recolte" });
            })
        );
      }

      // Caporal: pointages en attente validation + rejetés + tâches HR non terminées + demandes résultat
      if (profile.startsWith("caporal_")) {
        promises.push(
          db_firestore.collection("pointage_validations")
            .where("date", "in", last7).get()
            .then(snap => {
              const pending = snap.docs.filter(d => {
                const v = d.data();
                return v.ferme === ferme && v.visaRH && !v.visaCaporal && !v.rejected && !v.locked;
              });
              if (pending.length > 0) categories.validations.push({ key: "pointage_caporal", label: "Pointages en attente de votre validation", count: pending.length, icon: "fa-clipboard-check", color: "#e67e22", tab: "pointage" });
              const rejected = snap.docs.filter(d => {
                const v = d.data();
                return v.ferme === ferme && v.rejected;
              });
              if (rejected.length > 0) categories.alertes.push({ key: "pointage_rejected", label: "Pointages rejetés à corriger", count: rejected.length, icon: "fa-exclamation-triangle", color: "#e74c3c", tab: "pointage" });
            })
        );
        promises.push(
          db_firestore.collection("suivi-hors-recolte-cumul")
            .where("ferme", "==", ferme)
            .where("termine", "==", false)
            .get()
            .then(snap => {
              if (snap.size > 0) categories.taches.push({ key: "hr_non_terminees", label: "Tâches hors-récolte en cours", count: snap.size, icon: "fa-list-check", color: "#f39c12", tab: "suivi_avancement" });
            })
        );
        promises.push(
          db_firestore.collection("suivi-hors-recolte-demandes")
            .where("ferme", "==", ferme)
            .get()
            .then(snap => {
              const recent = snap.docs.filter(d => {
                const data = d.data();
                return (data.statut === "validee" || data.statut === "refusee") && data.valideAt;
              });
              if (recent.length > 0) categories.alertes.push({ key: "demandes_result", label: "Demandes ré-exécution traitées", count: recent.length, icon: "fa-bell", color: "#3498db", tab: "suivi_avancement" });
            })
        );
      }

      // DG: BDC attente DG + factures DG
      if (profile === "dg") {
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_dg").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_dg", label: "BDC en attente DG", count: snap.size, icon: "fa-stamp", color: "#9b59b6", tab: "dg_validations" });
            })
        );
        promises.push(
          db_firestore.collection("invoices")
            .where("payment_status", "==", "validee_finance").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "factures_dg", label: "Factures à valider", count: snap.size, icon: "fa-file-invoice-dollar", color: "#e74c3c", tab: "dg_validations" });
            })
        );
        // Articles réclamés par les magasiniers, que seul le DG peut créer.
        // Sans ce compteur, la demande n'existerait que dans une collection que
        // personne n'ouvre : un refus fail-closed sans destinataire visible
        // n'est pas un flux de travail, c'est une impasse.
        // `tab` pointe vers l'écran Catalogue EXISTANT — celui qui porte déjà
        // le bouton « Nouvel article » (canCreateArticle = achats | dg). Rien à
        // ajouter côté front : l'agrégateur est générique.
        promises.push(
          db_firestore.collection(demandeCreationArticle.COLLECTION)
            .where("statut", "==", demandeCreationArticle.STATUT_EN_ATTENTE).get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "articles_a_creer", label: "Articles à créer (demandes magasinier)", count: snap.size, icon: "fa-box-open", color: "#e67e22", tab: "achats_catalogue" });
            })
        );
      }

      // Finance: factures + virements
      if (profile === "finance") {
        promises.push(
          db_firestore.collection("invoices")
            .where("payment_status", "==", "validee_achats").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "factures_finance", label: "Factures à valider", count: snap.size, icon: "fa-file-invoice-dollar", color: "#3498db", tab: "fin_factures" });
            })
        );
        promises.push(
          db_firestore.collection("demandes_virement")
            .where("status", "==", "en_attente").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "virements_pending", label: "Virements en attente", count: snap.size, icon: "fa-money-bill-transfer", color: "#27ae60", tab: "fin_virements" });
            })
        );
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "envoye").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_envoye", label: "BDC envoyés — virement à lancer", count: snap.size, icon: "fa-file-contract", color: "#e67e22", tab: "fin_bdc" });
            })
        );
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "virement_lance").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_virement_lance", label: "Virements lancés — en attente signature", count: snap.size, icon: "fa-pen-nib", color: "#9b59b6", tab: "fin_bdc" });
            })
        );
      }

      // Achats: DA + BDC + factures + fournisseurs
      if (profile === "achats") {
        promises.push(
          db_firestore.collection("purchase_requests")
            .where("status", "==", "soumise").get()
            .then(snap => {
              const daList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
              if (snap.size > 0) categories.validations.push({
                key: "da_soumises", label: "DA à approuver", count: snap.size, icon: "fa-file-lines", color: "#f39c12", tab: "achats_da",
                details: daList.slice(0, 5).map(d => ({ text: (d.numero || "") + " — " + (d.ferme || "") + (d.urgence && d.urgence !== "normale" ? " (" + d.urgence + ")" : ""), urgent: d.urgence === "critique" || d.urgence === "urgente" }))
              });
            })
        );
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "brouillon").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_brouillon", label: "BDC brouillon à compléter", count: snap.size, icon: "fa-file-pen", color: "#3498db", tab: "achats_bdc" });
            })
        );
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_chef").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_attente_chef", label: "BDC attente Chef", count: snap.size, icon: "fa-user-check", color: "#e67e22", tab: "achats_bdc" });
            })
        );
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_dg").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_attente_dg", label: "BDC attente DG", count: snap.size, icon: "fa-stamp", color: "#9b59b6", tab: "achats_bdc" });
            })
        );
        promises.push(
          db_firestore.collection("invoices")
            .where("payment_status", "==", "en_validation").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "factures_achats", label: "Factures à valider", count: snap.size, icon: "fa-file-invoice-dollar", color: "#e74c3c", tab: "achats_paiements" });
            })
        );
      }

      // Qualité: expéditions en attente
      if (profile === "qualite") {
        promises.push(
          db_firestore.collection("expeditions")
            .where("status", "==", "en_attente").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "expeditions_pending", label: "Expéditions en attente", count: snap.size, icon: "fa-truck", color: "#8e44ad", tab: "qualite_expeditions" });
            })
        );
      }

      // DT: pointages F1+F5 non validés
      if (profile === "dt") {
        promises.push(
          db_firestore.collection("pointage_validations")
            .where("date", "in", last7).get()
            .then(snap => {
              const pending = snap.docs.filter(d => {
                const v = d.data();
                return (v.ferme === "F1" || v.ferme === "F5") && !v.locked && !v.rejected;
              });
              if (pending.length > 0) categories.validations.push({ key: "pointage_dt", label: "Pointages non validés (F1+F5)", count: pending.length, icon: "fa-clipboard-check", color: "#1a5276", tab: "pointage" });
            })
        );
      }

      // ---- Alerts from Firestore (expedition_manquante, new_agq_analyses, etc.) ----
      const alertProfiles = ['chef_f1', 'chef_f5', 'chef_avo', 'qualite', 'dg', 'achats', 'finance', 'dt'];
      if (alertProfiles.includes(profile)) {
        promises.push(
          db_firestore.collection("alerts")
            .where("profiles", "array-contains", profile)
            .orderBy("createdAt", "desc")
            .limit(20)
            .get()
            .then(snap => {
              snap.docs.forEach(doc => {
                const a = doc.data();
                const isRead = a.read && a.read[profile];
                if (!isRead) {
                  if ((profile === 'dg' || profile === 'qualite') && a.type === 'expedition_manquante') return;
                  const isAgq = a.type === 'new_agq_analyses';
                  categories.alertes.push({
                    key: 'alert_' + doc.id,
                    label: a.message || 'Alerte',
                    count: 1,
                    icon: isAgq
                      ? 'fa-flask-vial'
                      : (a.type === 'expedition_manquante' ? 'fa-truck-ramp-box' : 'fa-triangle-exclamation'),
                    color: isAgq
                      ? '#7c3aed'
                      : (a.severity === 'info' ? '#2563eb' : a.severity === 'warning' ? '#f39c12' : '#e74c3c'),
                    tab: isAgq ? 'chef_agronomie' : 'qualite_expeditions',
                    alertId: doc.id,
                  });
                }
              });
            })
            .catch(err => console.warn('Alerts query error:', err))
        );
      }

      // ---- Await all promises ----
      await Promise.all(promises);

      // ---- Process tasks result ----
      const tasksSnap = await tasksPromise;
      const allTasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const overdue = allTasks.filter(t => t.deadline && t.deadline < today);
      const inProgress = allTasks.filter(t => t.status === "en_cours");
      const todo = allTasks.filter(t => t.status === "a_faire");

      if (overdue.length > 0) {
        categories.taches.push({ key: "tasks_overdue", label: "Tâches en retard", count: overdue.length, icon: "fa-clock", color: "#e74c3c", tab: "dg_tasks" });
      }
      if (inProgress.length > 0) {
        categories.taches.push({ key: "tasks_en_cours", label: "Tâches en cours", count: inProgress.length, icon: "fa-spinner", color: "#3498db", tab: "dg_tasks" });
      }
      if (todo.length > 0) {
        categories.taches.push({ key: "tasks_a_faire", label: "Tâches à faire", count: todo.length, icon: "fa-list-check", color: "#f39c12", tab: "dg_tasks" });
      }

      const totalCount = Object.values(categories).reduce((sum, cat) => sum + cat.reduce((s, item) => s + item.count, 0), 0);

      return res.json({ success: true, categories, totalCount });
    } catch (err) {
      console.error("Erreur notifications:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Alerts — List and manage alerts
// =============================================
exports.alerts = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const action = req.query.action || req.body?.action || "list";
      const profile = req.query.profile || req.body?.profile || "";

      if (action === "list") {
        const snap = await db_firestore.collection("alerts")
          .orderBy("createdAt", "desc")
          .limit(50)
          .get();
        const alerts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(a => !profile || (a.profiles && a.profiles.includes(profile)));
        return res.json({ success: true, alerts });
      }

      if (action === "mark-read") {
        const alertId = req.body?.alertId;
        if (!alertId || !profile) return res.status(400).json({ success: false, error: "alertId and profile required" });
        await db_firestore.collection("alerts").doc(alertId).update({
          [`read.${profile}`]: true,
        });
        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, error: "Unknown action" });
    } catch (err) {
      console.error("Erreur alerts:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// Gestion de Caisse — Cash Management
// =============================================
exports.onAlertCreated = functions
  .region("europe-west1")
  .firestore.document("alerts/{alertId}")
  .onCreate(async (snap) => {
    const alert = snap.data();
    if (!alert.profiles || alert.profiles.length === 0) return;
    // Skip if dispatcher already sent WhatsApp for this alert (avoid double send)
    if (alert.whatsapp_dispatched) return;
    const type = alert.type === "expedition_manquante" ? "quality_alert" : "general_alert";
    await dispatchNotification({
      type,
      profiles: alert.profiles,
      data: { message: alert.message || "Nouvelle alerte" },
      channels: ["whatsapp"], // in-app alert already exists
    }).catch(err => console.error("WhatsApp onAlertCreated error:", err));
  });

/**
 * whatsappAdmin — Admin API for WhatsApp configuration.
 * Actions: get-config, update-config, test-message, get-logs
 */
exports.whatsappAdmin = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
      const decoded = await verifyAuth(req);
      if (!decoded) return res.status(401).json({ success: false, error: "Non authentifié" });

      const callerDoc = await db_firestore.collection("users").doc(decoded.uid).get();
      if (!callerDoc.exists || callerDoc.data().role !== "admin") {
        return res.status(403).json({ success: false, error: "Accès réservé aux administrateurs" });
      }

      const action = req.query.action || "get-config";

      if (action === "get-config") {
        const doc = await db_firestore.collection("config").doc("whatsapp").get();
        const config = doc.exists ? doc.data() : {};
        // Mask the access token for security
        if (config.access_token) {
          config.access_token_masked = config.access_token.slice(0, 10) + "..." + config.access_token.slice(-4);
          delete config.access_token;
        }
        return res.json({ success: true, config });
      }

      if (action === "update-config" && req.method === "POST") {
        const { phone_number_id, waba_id, access_token, enabled, default_language } = req.body;
        const updates = { updated_at: Date.now(), updated_by: decoded.uid };
        if (phone_number_id !== undefined) updates.phone_number_id = phone_number_id;
        if (waba_id !== undefined) updates.waba_id = waba_id;
        if (access_token !== undefined && access_token !== "") updates.access_token = access_token;
        if (enabled !== undefined) updates.enabled = enabled;
        if (default_language !== undefined) updates.default_language = default_language;
        await db_firestore.collection("config").doc("whatsapp").set(updates, { merge: true });
        whatsappService.clearConfigCache();
        return res.json({ success: true });
      }

      if (action === "test-message" && req.method === "POST") {
        const { phone, template_name } = req.body;
        if (!phone) return res.status(400).json({ success: false, error: "Numéro requis" });
        const result = await whatsappService.sendTemplateMessage(
          phone,
          template_name || "general_alert",
          [template_name ? "Test depuis SmartBerry" : "Ceci est un message de test SmartBerry"]
        );
        return res.json({ success: result.success, error: result.error, waMessageId: result.waMessageId });
      }

      if (action === "simulate-template" && req.method === "POST") {
        const { template_name, params, phone, profiles, ferme, type } = req.body;
        if (!template_name) return res.status(400).json({ success: false, error: "template_name requis" });

        // Direct send to a specific phone
        if (phone) {
          const result = await whatsappService.sendTemplateMessage(phone, template_name, params || []);
          return res.json({ success: result.success, error: result.error, waMessageId: result.waMessageId });
        }

        // Dispatch via type to profiles (uses notificationDispatcher mapping)
        if (type && profiles && profiles.length > 0) {
          const { dispatchNotification } = require("../../../notificationDispatcher");
          // Build data object based on params for known types
          const data = req.body.data || {};
          if (params && Array.isArray(params)) {
            // Map params positionally to common fields
            data._raw_params = params;
          }
          await dispatchNotification({
            type, profiles, ferme,
            data: { ...data, message: data.message || `Test ${type}` },
            relatedDoc: `simulation/${type}-${Date.now()}`,
          });
          return res.json({ success: true });
        }

        return res.status(400).json({ success: false, error: "phone OU (type + profiles) requis" });
      }

      if (action === "test-expedition-rejected" && req.method === "POST") {
        const { ferme, variety, weightKg, reason, profiles } = req.body;
        const { dispatchNotification } = require("../../../notificationDispatcher");
        const dateTime = new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
        const receiptId = `RPT-TEST-${Date.now().toString().slice(-6)}`;
        await dispatchNotification({
          type: "expedition_rejected",
          profiles: profiles || ["chef", "qualite", "dg"],
          ferme: ferme || "BSAA",
          data: {
            receiptId,
            dateTime,
            variety: variety || "Sweet Sensation",
            ranch: ferme || "BSAA",
            weightKg: weightKg || "1250",
            reason: reason || "Soft fruit 18%, Bruising 12%",
            message: `Expédition ${receiptId} rejetée (TEST)`,
          },
          relatedDoc: `expeditions/TEST-${receiptId}`,
        });
        return res.json({ success: true, receiptId });
      }

      if (action === "send-welcome" && req.method === "POST") {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: "UID utilisateur requis" });
        const userDoc = await db_firestore.collection("users").doc(uid).get();
        if (!userDoc.exists) return res.status(404).json({ success: false, error: "Utilisateur introuvable" });
        const u = userDoc.data();
        if (!u.whatsappPhone) return res.status(400).json({ success: false, error: "Cet utilisateur n'a pas de numéro WhatsApp" });
        const firstName = (u.displayName || "").split(" ")[0] || u.displayName || u.email?.split("@")[0] || "utilisateur";
        const result = await whatsappService.sendTemplateMessage(
          u.whatsappPhone,
          "welcome_smartberry",
          [firstName]
        );
        if (result.success) {
          await db_firestore.collection("users").doc(uid).update({ welcome_sent_at: Date.now() });
        }
        return res.json({ success: result.success, error: result.error });
      }

      if (action === "send-welcome-all" && req.method === "POST") {
        const { force } = req.body || {};
        const snap = await db_firestore.collection("users").get();
        let sent = 0, skipped = 0, failed = 0;
        const errors = [];
        for (const doc of snap.docs) {
          const u = doc.data();
          if (!u.whatsappPhone || u.disabled) { skipped++; continue; }
          if (!force && u.welcome_sent_at) { skipped++; continue; }
          const firstName = (u.displayName || "").split(" ")[0] || u.displayName || u.email?.split("@")[0] || "utilisateur";
          const result = await whatsappService.sendTemplateMessage(
            u.whatsappPhone,
            "welcome_smartberry",
            [firstName]
          );
          if (result.success) {
            sent++;
            await db_firestore.collection("users").doc(doc.id).update({ welcome_sent_at: Date.now() });
          } else {
            failed++;
            errors.push({ user: u.displayName || u.email, error: result.error });
          }
          await new Promise(r => setTimeout(r, 200));
        }
        return res.json({ success: true, sent, skipped, failed, errors });
      }

      if (action === "get-logs") {
        const limit = parseInt(req.query.limit) || 50;
        const snap = await db_firestore.collection("whatsapp_logs")
          .orderBy("sentAt", "desc").limit(limit).get();
        const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, logs });
      }

      if (action === "retry-log" && req.method === "POST") {
        const { log_id } = req.body;
        if (!log_id) return res.status(400).json({ success: false, error: "log_id requis" });
        const logDoc = await db_firestore.collection("whatsapp_logs").doc(log_id).get();
        if (!logDoc.exists) return res.status(404).json({ success: false, error: "Log introuvable" });
        const log = logDoc.data();
        if (log.retried_at) return res.status(400).json({ success: false, error: "Ce message a déjà été retenté" });
        const result = await whatsappService.sendTemplateMessage(
          log.to,
          log.templateName,
          log.params || []
        );
        if (result.success) {
          await db_firestore.collection("whatsapp_logs").doc(log_id).update({
            retried_at: Date.now(),
            retry_message_id: result.waMessageId || null,
          });
        }
        return res.json({ success: result.success, error: result.error, waMessageId: result.waMessageId });
      }

      if (action === "get-messages") {
        const limit = parseInt(req.query.limit) || 50;
        const snap = await db_firestore.collection("whatsapp_messages")
          .orderBy("receivedAt", "desc").limit(limit).get();
        const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, messages });
      }

      if (action === "generate-verify-token" && req.method === "POST") {
        const token = require("crypto").randomBytes(32).toString("hex");
        await db_firestore.collection("config").doc("whatsapp").set(
          { webhook_verify_token: token, updated_at: Date.now() }, { merge: true }
        );
        whatsappService.clearConfigCache();
        return res.json({ success: true, verify_token: token });
      }

      if (action === "get-verify-token") {
        const doc = await db_firestore.collection("config").doc("whatsapp").get();
        const verify_token = doc.exists ? doc.data().webhook_verify_token : null;
        return res.json({ success: true, verify_token });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur whatsappAdmin:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

/**
 * whatsappWebhook — Receives status updates and incoming messages from Meta.
 *
 * GET: verification challenge (Meta sends ?hub.verify_token=...&hub.challenge=...)
 * POST: notification payload with statuses[] or messages[]
 *
 * Setup in Meta App → WhatsApp → Configuration:
 *   URL: https://europe-west1-berrygood-farms-dashboard.cloudfunctions.net/whatsappWebhook
 *   Verify token: stored in config/whatsapp.webhook_verify_token
 *   Subscribe to: messages, message_status
 */
const WA_INCOMING_TOPIC = "whatsapp-incoming";
let _pubsubClient = null;
function getPubSub() {
  if (!_pubsubClient) {
    const { PubSub } = require("@google-cloud/pubsub");
    _pubsubClient = new PubSub();
  }
  return _pubsubClient;
}

exports.whatsappWebhook = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 15, memory: "256MB", minInstances: 1 })
  .https.onRequest(async (req, res) => {
    try {
      // GET — verification handshake
      if (req.method === "GET") {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];
        const configDoc = await db_firestore.collection("config").doc("whatsapp").get();
        const expectedToken = configDoc.exists ? configDoc.data().webhook_verify_token : null;
        if (mode === "subscribe" && token && token === expectedToken) {
          console.log("Webhook verified");
          return res.status(200).send(challenge);
        }
        return res.status(403).send("Forbidden");
      }

      // POST — publish to Pub/Sub and ack immediately
      if (req.method === "POST") {
        const body = req.body || {};
        try {
          const data = Buffer.from(JSON.stringify(body));
          await getPubSub().topic(WA_INCOMING_TOPIC).publishMessage({ data });
        } catch (pubErr) {
          console.error("Pub/Sub publish failed:", pubErr.message);
          // Still ack 200 to prevent Meta retries — we'd rather drop than retry
        }
        return res.status(200).send("EVENT_RECEIVED");
      }

      return res.status(405).send("Method not allowed");
    } catch (err) {
      console.error("Erreur whatsappWebhook:", err);
      if (!res.headersSent) res.status(200).send("ERROR_LOGGED");
    }
  });

/**
 * processWhatsappIncoming — Pub/Sub triggered processor for incoming Meta events.
 *
 * Decouples heavy work (Vision OCR, Firestore writes, Graph API sends) from the
 * HTTP webhook ack path. Functions Gen 1 HTTP can't reliably do background work
 * after res.send() — Pub/Sub triggers run for their full duration without freeze.
 */
exports.processWhatsappIncoming = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .pubsub.topic(WA_INCOMING_TOPIC)
  .onPublish(async (message) => {
    try {
      const body = message.json || (message.data ? JSON.parse(Buffer.from(message.data, "base64").toString()) : {});
      const { processIncomingEvent } = require("../../../whatsappProcessor");
      await processIncomingEvent(body);
    } catch (err) {
      console.error("processWhatsappIncoming error:", err);
      throw err; // Let Pub/Sub retry
    }
  });

// =============================================
// Netafim GrowSphere V3 — irrigation sync for ferme BAHIA
// =============================================
// Reads programmateur events (vannes, volumes, durées, EC/pH) and persists
// them into the existing `irrigation_readings` collection with ferme="BAHIA"
// so the irrigation UI surfaces BAHIA alongside F1/F5. Config lives in
// Firestore doc `config/netafim`; daily quota and last-run cursor in
// `config/netafim_sync`. See functions/lib/netafim/index.js for details.

exports.bdpIntrospect = functions
  .region("europe-west1")
  .runWith({ secrets: ["ADMIN_SECRET"], timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");
    if (req.method === "OPTIONS") return res.status(204).send("");

    const adminSecret = process.env.ADMIN_SECRET;
    const provided =
      (req.query && req.query.secret) ||
      req.get("x-admin-secret") ||
      (req.body && req.body.secret);
    if (!adminSecret || provided !== adminSecret) {
      return res.status(403).json({ success: false, error: "forbidden" });
    }

    try {
      const report = await bdpIntrospectService.introspect();
      return res.status(report.success ? 200 : 500).json(report);
    } catch (err) {
      console.error("[bdpIntrospect] error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// syncPointageBdpTrigger — P2b : pull pointage FACTUEL BDP → collection TÉMOIN.
// ⚠️ ZÉRO écriture live. Écrit UNIQUEMENT dans sql_mirror_pointage_bdp_test.
// Protégé par ADMIN_SECRET (comme bdpIntrospect).
// Appel : GET /api/sync-pointage-bdp-test?secret=<ADMIN_SECRET>&from=YYYY-MM-DD&to=YYYY-MM-DD
//   (from/to optionnels → défaut fenêtre ~7 jours glissants)
// ─────────────────────────────────────────────────────────────────────────────
