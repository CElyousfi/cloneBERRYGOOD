/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { paieAccess } = require("./_shared");
const { COLLECTION, admin, bucket, consoAccessControl, db_firestore, dispatchNotification, functions, getPointageRowsForDateRange, localDateStr, requireAuth, resolveCallerProfile, resolveCallerRole, scanAttachment, setCors, withCache } = require("../../shared/core");

exports.productivityReportsCron = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .pubsub.schedule("every 15 minutes")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { console.warn("productivityReportsCron: ANTHROPIC_API_KEY missing, skipping"); return null; }

    const { ImapFlow } = require("imapflow");
    const { simpleParser } = require("mailparser");
    const productivity = require("../../../lib/productivity");

    const client = new ImapFlow({
      host: process.env.IMAP_HOST,
      port: parseInt(process.env.IMAP_PORT || "993"),
      secure: process.env.IMAP_TLS !== "false",
      auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
      logger: false,
    });

    try {
      await client.connect();
      let bucket = null;
      try { bucket = admin.storage().bucket("berrygood-farms-photos"); } catch (_) { /* no bucket */ }
      const result = await productivity.refetchProductivityReports({
        imapClient: client,
        simpleParser,
        db: admin.firestore(),
        bucket,
        apiKey,
        mailbox: process.env.IMAP_MAILBOX || "INBOX",
        onlyNew: true,    // cron only picks unseen messages
        maxEmails: 50,
      });
      console.log(`productivityReportsCron: processed=${result.processed} skipped=${result.skipped}`);
    } catch (err) {
      console.error("productivityReportsCron error:", err.message);
    } finally {
      try { await client.logout(); } catch (_) { /* ignore */ }
    }
    return null;
  });

exports.ojra = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const action = req.query.action || "summary";

    // import accepts either an authenticated user OR a server-side API key.
    if (action === "import" && req.method === "POST") {
      const apiKey = req.headers["x-api-key"] || req.query.key;
      const expectedKey = process.env.OJRA_IMPORT_KEY;
      const keyOk = expectedKey && apiKey === expectedKey;
      if (!keyOk) {
        const authUser = await requireAuth(req, res);
        if (!authUser) return;
      }
    } else {
      const authUser = await requireAuth(req, res);
      if (!authUser) return;
    }

    try {
      const COLLECTION = "ojra_payroll";
      const META_DOC = db_firestore.collection("api_metadata").doc("ojra");

      if (action === "import" && req.method === "POST") {
        const { file, period, importedBy, dryRun } = req.body || {};
        if (!file) return res.status(400).json({ success: false, error: "file (base64) requis" });
        if (!period || !/^\d{4}-\d{2}-\d{2}$/.test(period)) {
          return res.status(400).json({ success: false, error: "period requis au format YYYY-MM-DD (samedi début de quinzaine)" });
        }

        const { parseOjraExcel } = require("../../../ojraParser");
        let parsed;
        try {
          parsed = parseOjraExcel(file);
        } catch (err) {
          return res.status(400).json({ success: false, error: "Excel illisible: " + err.message });
        }

        const allRecords = [];
        for (const s of parsed.sheets) {
          if (s.skipped) continue;
          for (const r of s.records) allRecords.push({ ...r, _sheet: s.name });
        }

        if (allRecords.length === 0) {
          return res.status(400).json({
            success: false,
            error: "Aucune ligne de paie reconnue. Vérifier que les en-têtes contiennent au moins matricule/nom et un montant (brut, net, CNSS).",
            meta: parsed.meta,
            sheets: parsed.sheets.map(s => ({ name: s.name, skipped: !!s.skipped, reason: s.reason || null, detectedColumns: s.detectedColumns || [] })),
          });
        }

        if (dryRun) {
          return res.json({
            success: true,
            dryRun: true,
            period,
            totals: parsed.totals,
            sheets: parsed.sheets.map(s => ({
              name: s.name, skipped: !!s.skipped, reason: s.reason || null,
              detectedColumns: s.detectedColumns || [], nbRecords: s.records ? s.records.length : 0,
            })),
            sample: allRecords.slice(0, 5),
          });
        }

        const importedAt = admin.firestore.Timestamp.fromDate(new Date());
        const periodKey = period;

        const BATCH_SIZE = 400;
        let batch = db_firestore.batch();
        let batchCount = 0;
        let imported = 0;

        for (const rec of allRecords) {
          const matKey = (rec.matricule || "").replace(/[\/\.\s#\[\]*]/g, "_");
          const nomKey = (rec.nomComplet || rec.nom || "anon").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
          const docId = `${periodKey}__${matKey || nomKey}`.slice(0, 200);

          batch.set(db_firestore.collection(COLLECTION).doc(docId), {
            period: periodKey,
            matricule: rec.matricule || "",
            nom: rec.nomComplet || rec.nom || "",
            poste: rec.poste || "",
            service: rec.service || "",
            ferme: rec.ferme || "",
            joursTravailles: rec.joursTravailles || 0,
            heuresNormales: rec.heuresNormales || 0,
            heuresSupp: rec.heuresSupp || 0,
            salaireBase: rec.salaireBase || 0,
            salaireBrut: rec.salaireBrut || 0,
            salaireImposable: rec.salaireImposable || 0,
            salaireNet: rec.salaireNet || 0,
            cnssEmploye: rec.cnssEmploye || 0,
            cnssEmployeur: rec.cnssEmployeur || 0,
            amoEmploye: rec.amoEmploye || 0,
            amoEmployeur: rec.amoEmployeur || 0,
            ir: rec.ir || 0,
            cimr: rec.cimr || 0,
            primes: rec.primes || 0,
            avances: rec.avances || 0,
            sourceSheet: rec._sheet || "",
            source: "ojra",
            importedAt,
            importedBy: importedBy || null,
          }, { merge: true });
          batchCount++;
          imported++;
          if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = db_firestore.batch();
            batchCount = 0;
          }
        }
        if (batchCount > 0) await batch.commit();

        await db_firestore.collection("ojra_period_totals").doc(periodKey).set({
          period: periodKey,
          ...parsed.totals,
          importedAt,
          importedBy: importedBy || null,
          sheets: parsed.sheets.filter(s => !s.skipped).map(s => s.name),
        }, { merge: true });

        await META_DOC.set({
          lastImportAt: importedAt,
          lastPeriod: periodKey,
          lastImportCount: imported,
        }, { merge: true });

        await db_firestore.collection("api_cache").doc("ojra_summary").delete().catch(() => {});

        return res.json({ success: true, imported, period: periodKey, totals: parsed.totals });
      }

      if (action === "summary") {
        const cached = await withCache("ojra_summary", 10 * 60 * 1000, async () => {
          const periodsSnap = await db_firestore.collection("ojra_period_totals")
            .orderBy("period", "desc").limit(24).get();
          const periods = periodsSnap.docs.map(d => {
            const t = d.data();
            return {
              period: t.period,
              nbEmployes: t.nbEmployes || 0,
              salaireBrut: t.salaireBrut || 0,
              salaireNet: t.salaireNet || 0,
              chargesSocialesTotal: t.chargesSocialesTotal || 0,
              cnssEmploye: t.cnssEmploye || 0,
              cnssEmployeur: t.cnssEmployeur || 0,
              amoEmploye: t.amoEmploye || 0,
              amoEmployeur: t.amoEmployeur || 0,
              ir: t.ir || 0,
              cimr: t.cimr || 0,
              importedAt: t.importedAt && t.importedAt.toDate ? t.importedAt.toDate().toISOString() : null,
            };
          });

          let lastImportAt = null;
          let lastPeriod = null;
          try {
            const meta = await META_DOC.get();
            if (meta.exists) {
              const m = meta.data();
              lastImportAt = m.lastImportAt && m.lastImportAt.toDate ? m.lastImportAt.toDate().toISOString() : null;
              lastPeriod = m.lastPeriod || null;
            }
          } catch (_) { /* ignore */ }

          return {
            success: true,
            latest: periods[0] || null,
            periods,
            lastImportAt,
            lastPeriod,
          };
        });
        return res.json(cached);
      }

      if (action === "detail") {
        const period = req.query.period;
        if (!period) return res.status(400).json({ success: false, error: "period requis" });
        const snap = await db_firestore.collection(COLLECTION).where("period", "==", period).get();
        const records = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.salaireBrut || 0) - (a.salaireBrut || 0));
        return res.json({ success: true, period, count: records.length, records });
      }

      if (action === "periods") {
        const snap = await db_firestore.collection("ojra_period_totals")
          .orderBy("period", "desc").limit(48).get();
        const periods = snap.docs.map(d => d.data().period).filter(Boolean);
        return res.json({ success: true, periods });
      }

      if (action === "delete-period" && req.method === "POST") {
        const period = (req.body && req.body.period) || req.query.period;
        if (!period) return res.status(400).json({ success: false, error: "period requis" });
        const snap = await db_firestore.collection(COLLECTION).where("period", "==", period).get();
        let deleted = 0;
        let batch = db_firestore.batch();
        for (const doc of snap.docs) {
          batch.delete(doc.ref);
          deleted++;
          if (deleted % 400 === 0) {
            await batch.commit();
            batch = db_firestore.batch();
          }
        }
        if (deleted % 400 !== 0) await batch.commit();
        await db_firestore.collection("ojra_period_totals").doc(period).delete().catch(() => {});
        await db_firestore.collection("api_cache").doc("ojra_summary").delete().catch(() => {});
        return res.json({ success: true, deleted });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur ojra:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Notifications — Aggregated notifications per profile
// =============================================
const { canManagePrimes, forbiddenReason } = require("../../../lib/primes/primesAccess");
const { normalizeMatricule, buildImportPreview } = require("../../../lib/primes/primesImport");
const { buildPrimeUpdate } = require("../../../lib/primes/primeHistory");
const { buildIdentiteSyncPlan } = require("../../../lib/primes/identiteSync");
const { buildHeuresSupWrite, buildHeuresSupHistoryEntry } = require("../../../lib/primes/heuresSupWrite");
const emargementWrite = require("../../../lib/primes/emargementWrite");

exports.primesManagement = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");

    // ========== AUTH + GATING RÔLE (avant toute lecture/écriture) ==========
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    // Identité résolue SERVEUR : profileId via resolveCallerRole, role système
    // via users/{uid}.role (comme la caisse). Jamais depuis le body client.
    const profileId = await resolveCallerRole(authUser);
    let systemRole = "";
    let userName = authUser.name || authUser.email || "";
    try {
      const userDoc = await db_firestore.collection("users").doc(authUser.uid).get();
      if (userDoc.exists) {
        const ud = userDoc.data();
        systemRole = ud.role || "";
        userName = ud.fullName || ud.name || userName;
      }
    } catch (e) {
      systemRole = "";
    }

    if (!canManagePrimes({ profileId, role: systemRole })) {
      return res.status(403).json({ success: false, error: forbiddenReason() });
    }

    // Identité serveur figée pour l'audit (jamais du body).
    const actor = { uid: authUser.uid, profileId: profileId || "", name: userName };
    const now = Date.now();
    const action = req.query.action || (req.body && req.body.action) || "";
    const REGISTRY = db_firestore.collection("ouvriers_registry");

    try {
      // ---------- save-prime : prime de fonction (DH/jour) d'un ouvrier ----------
      if (action === "save-prime" && req.method === "POST") {
        const matricule = normalizeMatricule(req.body && req.body.matricule);
        if (!matricule) return res.status(400).json({ success: false, error: "matricule requis" });
        const montant = Number(req.body && req.body.montant) || 0;
        const effectiveFrom = String((req.body && req.body.effectiveFrom) || new Date().toISOString().slice(0, 10));

        const ref = REGISTRY.doc(matricule);
        const snap = await ref.get();
        const current = snap.exists ? snap.data() : null;
        const upd = buildPrimeUpdate({ current, montant, effectiveFrom, actor, now });
        // Conserve matricule/nom si nouveau doc.
        upd.matricule = matricule;
        if (!current || !current.nom) {
          const nom = String((req.body && req.body.nom) || "").trim();
          if (nom) upd.nom = nom;
        }
        await ref.set(upd, { merge: true });
        return res.json({ success: true, matricule, primeFonctionJournaliere: montant, effectiveFrom });
      }

      // ---------- heures-sup-montants : LECTURE des HS accordées d'une quinzaine ----------
      //
      // Les minutes de dépassement viennent de la badgeuse (action `heures-sup`),
      // mais le MONTANT accordé est une DÉCISION, pas un calcul : la paie inscrit
      // des montants ronds par ouvrier. On les stocke donc tels quels, et les
      // minutes badgées restent affichées à côté comme pièce justificative.
      //
      // Montant SAISI = NET (ce que l'ouvrier touche, comme la colonne « Prime
      // heure sup » du bulletin). La remontée au brut pour l'assiette est faite
      // par le modèle de coût, jamais ici.
      if (action === "heures-sup-montants" && req.method === "GET") {
        const periode = String(req.query.periode || "").trim();
        if (!periode) return res.status(400).json({ success: false, error: "periode requise" });
        const snap = await db_firestore.collection("rh_heures_sup").doc(periode).get();
        const d = snap.exists ? snap.data() : null;
        return res.json({
          success: true, periode,
          montants: (d && d.montants) || {},
          // États d'émargement SIGNÉS déposés, un par ferme. Renvoyés par CETTE
          // réponse et pas par un appel dédié : l'écran Quinzaine n'a alors pas
          // de lecture supplémentaire à attendre, donc pas de nouvelle clause à
          // ajouter à `_coherent` (app.jsx) qui protège l'instantané de campagne
          // d'un enregistrement partiel. Projection EXPLICITE : tout champ non
          // listé ici est silencieusement ignoré.
          emargements: (d && d.emargements) || {},
          updatedAt: (d && d.updatedAt) || null,
          updatedBy: (d && d.updatedBy) || null,
        });
      }

      // ---------- save-heures-sup : ÉCRITURE du montant d'UN ouvrier ----------
      if (action === "save-heures-sup" && req.method === "POST") {
        const periode = String((req.body && req.body.periode) || "").trim();
        const matricule = normalizeMatricule(req.body && req.body.matricule);
        if (!periode) return res.status(400).json({ success: false, error: "periode requise" });
        if (!matricule) return res.status(400).json({ success: false, error: "matricule requis" });
        const montant = Number(req.body && req.body.montant) || 0;
        if (montant < 0) return res.status(400).json({ success: false, error: "montant négatif" });

        const ref = db_firestore.collection("rh_heures_sup").doc(periode);
        // UN SEUL set mergé, dont le masque porte `montants.<matricule>` et
        // rien d'autre de la map : les montants des AUTRES ouvriers de la
        // quinzaine sont préservés, le document est créé s'il n'existe pas, et
        // l'opération est atomique. Forme construite par un helper pur testé
        // (functions/lib/primes/heuresSupWrite.js) — cf. le piège du `montants:
        // {}` qui écrasait toute la map.
        const hsWrite = buildHeuresSupWrite(periode, matricule, montant, { now, actor });
        await ref.set(hsWrite.data, hsWrite.options);

        // PISTE D'AUDIT — une entrée PAR SAISIE, en SOUS-COLLECTION.
        // `updatedAt`/`updatedBy` ci-dessus sont globaux au document : sur douze
        // ouvriers saisis, seule la douzième laisse une trace, et un montant
        // ramené de 800 à 0 n'en laisse aucune. Sous-collection et non tableau :
        // concaténer imposerait de LIRE le document avant d'écrire, ce que cette
        // action évite délibérément (deux saisies simultanées se courseraient).
        // `actor` vient du serveur (résolu en tête de la function), jamais du body.
        // ÉCRITURE SECONDAIRE : son échec n'annule PAS le montant déjà enregistré
        // — perdre une ligne d'audit est moins grave que perdre la saisie de paie.
        try {
          await ref.collection("history").add(
            buildHeuresSupHistoryEntry(periode, matricule, montant, { now, actor })
          );
        } catch (e) {
          console.error("save-heures-sup: historisation échouée", periode, matricule, e && e.message);
        }
        return res.json({ success: true, periode, matricule, montant });
      }

      // ---------- hs-emargement-submit : DÉPÔT de l'état d'émargement SIGNÉ ----------
      //
      // Le bouton « États d'émargement » GÉNÈRE des états à colonne signature
      // vide ; le chef de ferme signe sur papier. Cette action referme la boucle :
      // la RH dépose le scan signé, une pièce par FERME et par quinzaine.
      //
      // Modèle CANONIQUE du repo (cf. stock-file-submit) : le fichier est uploadé
      // CLIENT-DIRECT vers Storage (la limite de payload de 10 Mo des Cloud
      // Functions ne s'applique donc pas), et cette action ne fait que VALIDER
      // puis ENREGISTRER le lien. Un objet refusé est SUPPRIMÉ du bucket avant
      // tout enregistrement, pour ne laisser ni orphelin ni lien mort.
      if (action === "hs-emargement-submit" && req.method === "POST") {
        const periode = String((req.body && req.body.periode) || "").trim();
        const ferme = String((req.body && req.body.ferme) || "").trim();
        const storagePath = String((req.body && req.body.storage_path) || "").trim();
        const filename = String((req.body && req.body.filename) || "").trim();
        if (!periode) return res.status(400).json({ success: false, error: "periode requise" });
        if (!emargementWrite.normalizeFermeKey(ferme)) {
          return res.status(400).json({ success: false, error: "ferme requise" });
        }
        // Chemin revalidé SERVEUR : un client altéré ne doit pas pouvoir faire
        // enregistrer (ni exposer par URL signée) un objet situé ailleurs. La
        // PÉRIODE en fait partie : un objet du dossier de la quinzaine 04 ne
        // peut pas être enregistré comme l'état signé de la quinzaine 05.
        if (!emargementWrite.isEmargementPath(storagePath, periode)) {
          return res.status(400).json({ success: false, error: "storage_path hors du dossier de la quinzaine (" + emargementWrite.EMARGEMENT_PREFIX + ")" });
        }

        let exists = false;
        try { [exists] = await bucket.file(storagePath).exists(); } catch (_) { exists = false; }
        if (!exists) return res.status(400).json({ success: false, error: "Fichier introuvable dans le stockage (upload incomplet ?)" });

        let objMeta = null;
        try { [objMeta] = await bucket.file(storagePath).getMetadata(); } catch (_) { objMeta = null; }
        if (!objMeta) return res.status(400).json({ success: false, error: "Métadonnées du fichier illisibles" });
        // Allowlist PAR DÉFAUT (PDF + images) : un état d'émargement est un
        // document signé scanné ou photographié, jamais un tableur.
        const metaCheck = scanAttachment.validateAttachmentMetadata({ size: objMeta.size, contentType: objMeta.contentType });
        if (!metaCheck.valid) {
          try { await bucket.file(storagePath).delete(); } catch (_) { /* best effort cleanup */ }
          return res.status(400).json({ success: false, error: metaCheck.error });
        }

        // Écriture MERGÉE sur la seule feuille `emargements.<FERME>` : les états
        // des autres fermes ET la map `montants` (la paie) du même document sont
        // préservés. Forme construite par un helper pur testé
        // (functions/lib/primes/emargementWrite.js).
        const emWrite = emargementWrite.buildEmargementWrite(periode, ferme, {
          path: storagePath, filename, now, actor,
        });
        await db_firestore.collection("rh_heures_sup").doc(periode).set(emWrite.data, emWrite.options);
        const signedUrl = await scanAttachment.generateSignedUrl(bucket, storagePath);
        return res.json({
          success: true, periode, ferme_key: emWrite.fermeKey,
          emargement: emWrite.data.emargements[emWrite.fermeKey],
          url: signedUrl,
        });
      }

      // ---------- hs-emargement-url : URL SIGNÉE d'un état déjà déposé ----------
      // V4, 7 jours. JAMAIS d'URL publique : le document porte des identités
      // d'ouvriers et des montants.
      if (action === "hs-emargement-url" && req.method === "GET") {
        const periode = String(req.query.periode || "").trim();
        const fermeKey = emargementWrite.normalizeFermeKey(req.query.ferme);
        if (!periode) return res.status(400).json({ success: false, error: "periode requise" });
        if (!fermeKey) return res.status(400).json({ success: false, error: "ferme requise" });
        const snap = await db_firestore.collection("rh_heures_sup").doc(periode).get();
        const em = (snap.exists && snap.data().emargements) || {};
        const entry = em[fermeKey];
        if (!entry || !entry.path) return res.status(404).json({ success: false, error: "Aucun état d'émargement déposé pour cette ferme" });
        const signedUrl = await scanAttachment.generateSignedUrl(bucket, entry.path);
        if (!signedUrl) return res.status(500).json({ success: false, error: "URL de lecture indisponible" });
        return res.json({ success: true, periode, ferme_key: fermeKey, url: signedUrl });
      }

      // ---------- set-declare : déclaration ouvrier + baseline ancienneté ----------
      if (action === "set-declare" && req.method === "POST") {
        const matricule = normalizeMatricule(req.body && req.body.matricule);
        if (!matricule) return res.status(400).json({ success: false, error: "matricule requis" });
        const payload = { matricule, updatedAt: now, updatedBy: actor };
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "declare")) {
          payload.declare = req.body.declare === true;
          payload.declareSource = String((req.body && req.body.declareSource) || "manual");
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "baselineJours")) {
          payload.baselineJours = Number(req.body.baselineJours) || 0;
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "baselineDate")) {
          payload.baselineDate = String(req.body.baselineDate || "");
        }
        const nom = String((req.body && req.body.nom) || "").trim();
        if (nom) payload.nom = nom;
        await REGISTRY.doc(matricule).set(payload, { merge: true });
        return res.json({ success: true, matricule });
      }

      // ---------- update-identite : correction manuelle prenom/nom (ouvriers non déclarés) ----------
      if (action === "update-identite" && req.method === "POST") {
        const matricule = normalizeMatricule(req.body && req.body.matricule);
        if (!matricule) return res.status(400).json({ success: false, error: "matricule requis" });
        const prenom = String((req.body && req.body.prenom) || "").trim();
        const nom = String((req.body && req.body.nom) || "").trim();
        if (!prenom && !nom) {
          return res.status(400).json({ success: false, error: "prenom ou nom requis" });
        }
        const ref = REGISTRY.doc(matricule);
        const snap = await ref.get();
        if (!snap.exists) {
          return res.status(404).json({ success: false, error: "ouvrier introuvable dans ouvriers_registry" });
        }
        const upd = { updatedAt: now, updatedBy: actor };
        if (prenom) upd.prenom = prenom;
        if (nom) upd.nom = nom;
        await ref.update(upd);
        return res.json({ success: true, matricule, prenom, nom });
      }

      // ---------- sync-identite-bdp : backfill AUTO prenom/nom depuis BEE ONE ----------
      // Complète update-identite : au lieu d'une saisie manuelle ligne par ligne,
      // relit le référentiel Personnel BEE ONE (rhBdpService.getPersonnelRef,
      // READ-ONLY) et comble automatiquement les prenom/nom manquants dans
      // ouvriers_registry. Idempotent — ne réécrit JAMAIS un champ déjà non-vide,
      // même si la valeur BEE ONE diffère (aucune écrasement possible).
      if (action === "sync-identite-bdp" && req.method === "POST") {
        const rhBdpService = require("../../../rhBdpService");
        const bdpResult = await rhBdpService.getPersonnelRef();
        if (!bdpResult.success) {
          return res.status(502).json({ success: false, error: bdpResult.error || "Connexion BEE ONE échouée" });
        }

        const regSnap = await REGISTRY.get();
        const registryDocs = regSnap.docs.map(d => ({ id: d.id, data: d.data() || {} }));
        const plan = buildIdentiteSyncPlan(registryDocs, bdpResult.data || {});

        let batch = db_firestore.batch();
        let batchCount = 0;
        for (const item of plan.toUpdate) {
          batch.update(REGISTRY.doc(item.id), { ...item.update, updatedAt: now, updatedBy: actor });
          batchCount++;
          if (batchCount >= 400) {
            await batch.commit();
            batch = db_firestore.batch();
            batchCount = 0;
          }
        }
        if (batchCount > 0) await batch.commit();

        return res.json({
          success: true,
          updated: plan.toUpdate.length,
          notFoundInBdp: plan.notFoundInBdp,
          totalScanned: plan.totalScanned,
        });
      }

      // ---------- import-declares : batch "liste déclarés" ----------
      if (action === "import-declares" && req.method === "POST") {
        const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
        if (!rows) return res.status(400).json({ success: false, error: "rows[] requis" });
        let ok = 0;
        for (let i = 0; i < rows.length; i += 400) {
          const slice = rows.slice(i, i + 400);
          const batch = db_firestore.batch();
          for (const row of slice) {
            const matricule = normalizeMatricule(row && row.matricule);
            if (!matricule) continue;
            const payload = { matricule, declare: true, declareSource: "import", updatedAt: now, updatedBy: actor };
            const nom = String((row && row.nom) || "").trim();
            if (nom) payload.nom = nom;
            batch.set(REGISTRY.doc(matricule), payload, { merge: true });
            ok++;
          }
          await batch.commit();
        }
        return res.json({ success: true, imported: ok });
      }

      // ---------- import-baseline : batch "baseline jours" ----------
      if (action === "import-baseline" && req.method === "POST") {
        const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
        if (!rows) return res.status(400).json({ success: false, error: "rows[] requis" });
        let ok = 0;
        for (let i = 0; i < rows.length; i += 400) {
          const slice = rows.slice(i, i + 400);
          const batch = db_firestore.batch();
          for (const row of slice) {
            const matricule = normalizeMatricule(row && row.matricule);
            if (!matricule) continue;
            const payload = {
              matricule,
              baselineJours: Number((row && row.baselineJours)) || 0,
              baselineDate: String((row && row.baselineDate) || ""),
              updatedAt: now, updatedBy: actor,
            };
            const nom = String((row && row.nom) || "").trim();
            if (nom) payload.nom = nom;
            batch.set(REGISTRY.doc(matricule), payload, { merge: true });
            ok++;
          }
          await batch.commit();
        }
        return res.json({ success: true, imported: ok });
      }

      // ---------- import-primes : dry-run (preview) / apply ----------
      if (action === "import-primes" && req.method === "POST") {
        const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
        const mode = String((req.body && req.body.mode) || "dry-run");
        if (!rows) return res.status(400).json({ success: false, error: "rows[] requis" });

        // Liste des matricules registry existants (pour toCreate vs toUpdate).
        const regSnap = await REGISTRY.get();
        const registryMatricules = regSnap.docs.map(d => d.id);
        const preview = buildImportPreview(rows, registryMatricules);

        if (mode === "dry-run") {
          return res.json({
            success: true, mode: "dry-run",
            toCreate: preview.toCreate, toUpdate: preview.toUpdate,
            unmatched: preview.unmatched, collisions: preview.collisions,
            counts: {
              toCreate: preview.toCreate.length, toUpdate: preview.toUpdate.length,
              unmatched: preview.unmatched.length, collisions: preview.collisions.length,
            },
          });
        }

        // mode apply : applique UNIQUEMENT les lignes valides non ambiguës.
        const effectiveFrom = String((req.body && req.body.effectiveFrom) || new Date().toISOString().slice(0, 10));
        const applicable = preview.toCreate.concat(preview.toUpdate);
        let ok = 0;
        for (let i = 0; i < applicable.length; i += 400) {
          const slice = applicable.slice(i, i + 400);
          const refs = slice.map(r => REGISTRY.doc(r.matricule));
          const snaps = await Promise.all(refs.map(r => r.get()));
          const batch = db_firestore.batch();
          slice.forEach((r, idx) => {
            const current = snaps[idx].exists ? snaps[idx].data() : null;
            const upd = buildPrimeUpdate({ current, montant: r.montant, effectiveFrom, actor, now });
            upd.matricule = r.matricule;
            batch.set(refs[idx], upd, { merge: true });
            ok++;
          });
          await batch.commit();
        }
        return res.json({
          success: true, mode: "apply", applied: ok,
          skipped: { unmatched: preview.unmatched.length, collisions: preview.collisions.length },
        });
      }

      return res.status(400).json({ success: false, error: "Action inconnue" });
    } catch (err) {
      console.error("Erreur primesManagement:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// REGISTRY — lecture GATÉE du registre ouvrier (ouvriers_registry) — Étape 1 paie
// =============================================
//
// SÉCURITÉ CRITIQUE (fuite nominative de paie) : ouvriers_registry est lu en
// client-direct par 4 écrans. On migre chaque écran vers cette CF gatée, puis
// on durcira firestore.rules (read:false) EN DERNIER. Ici : LECTURE seule.
//
// Gating (fail-closed) AVANT toute lecture, calqué sur l'Étape 0 :
//   requireAuth (401) → resolveCallerProfile (token→users/{uid}) →
//   resolvePerimetre (périmètre ferme IMPOSÉ serveur, jamais du body) →
//   resolvePointageRHAccess → { allowed, fermeFilter }. !allowed → 403.
//
// Deux scopes :
//   - FULL (fermeFilter === null : RH/DG/Finance/admin) → registre COMPLET, tous
//     les champs de chaque doc (projectRegistryFull).
//   - CHEF (fermeFilter = sa ferme) → REQUIERT from/to ; set des matricules ayant
//     pointé SA ferme sur [from,to] (mirror), normalisé alpha→numérique, puis
//     projection RÉDUITE (jamais prime_history/fonction_history/updatedBy/
//     declareSource). from/to manquant → 400 (fail-closed).
//
// CACHE : on cache UNIQUEMENT le scope 'all' (clé `registry_all`, TTL court) —
// le registre change rarement et ce scope est identique pour tous les full-access.
// Le scope chef N'EST PAS caché : sa réponse dépend de (ferme, from, to) et du
// mirror ; le cacher risquerait un partage cross-périmètre (leçon Étape 0 :
// ne JAMAIS partager une entrée de cache entre périmètres). Interdit : clé unique
// sans dimension périmètre.
const registryAccess = require("../../../lib/auth/registryAccess");

exports.registryService = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");

    // ========== AUTH + GATING (avant toute lecture) ==========
    const authUser = await requireAuth(req, res);
    if (!authUser) return; // requireAuth a déjà répondu 401

    // Rôle/périmètre résolus SERVEUR (token → users/{uid}), jamais du body/query.
    const callerProfile = await resolveCallerProfile(authUser);
    const perim = consoAccessControl.resolvePerimetre(callerProfile, null);
    const access = paieAccess.resolvePointageRHAccess(perim);
    if (!access.allowed) {
      return res.status(403).json({ success: false, error: "Accès non autorisé" });
    }

    const action = req.query.action || (req.body && req.body.action) || "";
    const REGISTRY = db_firestore.collection("ouvriers_registry");

    try {
      if (action === "get-registry" && req.method === "GET") {
        // -------- Scope FULL ('all' : RH/DG/Finance/admin) --------
        if (access.fermeFilter === null) {
          // Cache périmètre-aware : clé fixe `registry_all` (identique pour tous
          // les full-access), TTL court (60s) — le registre change rarement.
          const payload = await withCache(
            "registry_all",
            60 * 1000, // TTL 60s (withCache attend des millisecondes)
            async () => {
              const snap = await REGISTRY.get();
              const docs = snap.docs.map(d => Object.assign({ __id: d.id }, d.data()));
              const ouvriers = registryAccess.projectRegistryFull(docs);
              return { success: true, ouvriers, perimetre: "all", count: ouvriers.length };
            }
          );
          return res.json(payload);
        }

        // -------- Scope CHEF (fermeFilter = sa ferme) --------
        const fermeFilter = access.fermeFilter;
        const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
        const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
        if (!from || !to) {
          // Fail-closed : sans fenêtre, on ne peut pas dériver le set matricules.
          return res.status(400).json({
            success: false,
            error: "Paramètres from et to requis (fenêtre de pointage) pour un périmètre ferme",
          });
        }

        // Set des matricules ayant pointé SA ferme sur [from,to], depuis le mirror.
        // ⚠️ le mirror est alpha-préfixé (DD10502), le registre numérique (10502).
        const {
          filterMirrorRowsByFerme,
          computeAllowedMatricules,
        } = require("../../../pointageService");
        const mirrorRows = await getPointageRowsForDateRange(from, to);
        // computeAllowedMatricules → set UPPERCASE alpha (DD10502) filtré ferme.
        const allowedRaw = computeAllowedMatricules(
          filterMirrorRowsByFerme(mirrorRows, fermeFilter),
          fermeFilter
        );
        // Normalisation alpha→numérique AVANT filtrage des docs registry.
        const allowedNum = registryAccess.normalizeAllowedSet(allowedRaw);

        // Scope chef NON caché (dépend de ferme+from+to, pas de partage cross-périmètre).
        const snap = await REGISTRY.get();
        const docs = snap.docs.map(d => Object.assign({ __id: d.id }, d.data()));
        const ouvriers = registryAccess.projectRegistryForChef(docs, allowedNum);
        return res.json({
          success: true,
          ouvriers,
          perimetre: fermeFilter,
          count: ouvriers.length,
        });
      }

      return res.status(400).json({ success: false, error: "Action inconnue" });
    } catch (err) {
      console.error("Erreur registryService:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// FONCTIONS — référentiel des fonctions + classement des ouvriers (V2 phase 2)
// =============================================
//
// SÉCURITÉ CRITIQUE (paie/RH) : le classement d'un ouvrier (fonction_id sur
// ouvriers_registry) conditionne sa prime de fonction. Toutes les écritures
// vers `fonctions` et `ouvriers_registry.fonction_id` passent EXCLUSIVEMENT
// par cette Cloud Function. Le rôle est résolu côté SERVEUR (resolveCallerRole
// + users/{uid}.role), jamais depuis le body. Périmètre IDENTIQUE aux primes :
// seuls profileId ∈ {rh, dg} OU role système 'admin' sont autorisés (réutilise
// canManagePrimes) ; tout autre profil (caporal, chef, magasinier...) reçoit
// 403 AVANT toute lecture/écriture.
const { buildFonctionUpdate } = require("../../../lib/fonctions/fonctionsHistory");
const {
  normalizeFonctionSlug,
  normalizeLibelle,
  normalizeOrdre,
} = require("../../../lib/fonctions/fonctionsValidate");

exports.fonctionsManagement = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");

    // ========== AUTH + GATING RÔLE (avant toute lecture/écriture) ==========
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    // Identité résolue SERVEUR : profileId via resolveCallerRole, role système
    // via users/{uid}.role. Jamais depuis le body client.
    const profileId = await resolveCallerRole(authUser);
    let systemRole = "";
    let userName = authUser.name || authUser.email || "";
    try {
      const userDoc = await db_firestore.collection("users").doc(authUser.uid).get();
      if (userDoc.exists) {
        const ud = userDoc.data();
        systemRole = ud.role || "";
        userName = ud.fullName || ud.name || userName;
      }
    } catch (e) {
      systemRole = "";
    }

    if (!canManagePrimes({ profileId, role: systemRole })) {
      return res.status(403).json({ success: false, error: forbiddenReason() });
    }

    // Identité serveur figée pour l'audit (jamais du body).
    const actor = { uid: authUser.uid, profileId: profileId || "", name: userName };
    const now = Date.now();
    const action = req.query.action || (req.body && req.body.action) || "";
    const REGISTRY = db_firestore.collection("ouvriers_registry");
    const FONCTIONS = db_firestore.collection("fonctions");
    const FieldValue = admin.firestore.FieldValue;

    try {
      // ---------- set-ouvrier-fonction : classe / déclasse un ouvrier -------
      if (action === "set-ouvrier-fonction" && req.method === "POST") {
        const matricule = String((req.body && req.body.matricule) || "").trim();
        if (!matricule) return res.status(400).json({ success: false, error: "matricule requis" });

        // fonction_id : soit une fonction existante, soit falsy (déclassement).
        const rawFonctionId = (req.body && req.body.fonction_id);
        const fonctionId = (rawFonctionId === undefined || rawFonctionId === null)
          ? "" : String(rawFonctionId).trim();

        // Classement : la fonction cible DOIT exister (no dangling ref).
        if (fonctionId) {
          const fSnap = await FONCTIONS.doc(fonctionId).get();
          if (!fSnap.exists) {
            return res.status(400).json({ success: false, error: "fonction inconnue" });
          }
        }

        const ref = REGISTRY.doc(matricule);
        const snap = await ref.get();
        const current = snap.exists ? snap.data() : null;

        // Historisation NON destructive (module pur). unset=true → déclassement.
        const upd = buildFonctionUpdate({ current, fonctionId, actor, now });
        const write = {
          fonction_by: upd.fonction_by,
          fonction_updated_at: upd.fonction_updated_at,
          fonction_history: upd.fonction_history,
          updatedAt: upd.updatedAt,
          matricule: matricule,
        };
        if (upd.unset) {
          // Déclassement : supprime fonction_id (jamais de string vide en base).
          write.fonction_id = FieldValue.delete();
        } else {
          write.fonction_id = upd.fonction_id;
        }
        await ref.set(write, { merge: true });
        return res.json({
          success: true,
          matricule,
          fonction_id: upd.unset ? null : upd.fonction_id,
        });
      }

      // ---------- create-fonction : ajoute une entrée au référentiel --------
      if (action === "create-fonction" && req.method === "POST") {
        const slug = normalizeFonctionSlug(req.body && req.body.fonction_id);
        if (!slug) return res.status(400).json({ success: false, error: "fonction_id (slug) invalide" });
        const libelle = normalizeLibelle(req.body && req.body.libelle);
        if (!libelle) return res.status(400).json({ success: false, error: "libelle requis" });
        const ordre = normalizeOrdre(req.body && req.body.ordre, 9990);

        await FONCTIONS.doc(slug).set({
          fonction_id: slug,
          libelle: libelle,
          ordre: ordre,
          active: true,
          prime_reference: null,
          created_at: now,
          updated_at: now,
          created_by: actor,
          updated_by: actor,
        }, { merge: true });
        return res.json({ success: true, fonction_id: slug });
      }

      // ---------- update-fonction : renomme / réordonne / (dés)active -------
      if (action === "update-fonction" && req.method === "POST") {
        const slug = normalizeFonctionSlug(req.body && req.body.fonction_id);
        if (!slug) return res.status(400).json({ success: false, error: "fonction_id (slug) invalide" });

        const ref = FONCTIONS.doc(slug);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "fonction inconnue" });

        // Update UNIQUEMENT les champs fournis. PAS de suppression (no-delete) :
        // désactivation via active:false.
        const write = { updated_at: now, updated_by: actor };
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "libelle")) {
          const libelle = normalizeLibelle(req.body.libelle);
          if (!libelle) return res.status(400).json({ success: false, error: "libelle vide" });
          write.libelle = libelle;
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "ordre")) {
          write.ordre = normalizeOrdre(req.body.ordre, snap.data().ordre);
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "active")) {
          write.active = req.body.active === true;
        }
        await ref.set(write, { merge: true });
        return res.json({ success: true, fonction_id: slug });
      }

      // ---------- list-fonctions : lecture du référentiel (pour l'UI) -------
      if (action === "list-fonctions" && (req.method === "GET" || req.method === "POST")) {
        const snap = await FONCTIONS.get();
        const list = snap.docs.map((d) => {
          const data = d.data() || {};
          return {
            fonction_id: data.fonction_id || d.id,
            libelle: data.libelle || d.id,
            ordre: (typeof data.ordre === "number") ? data.ordre : 9990,
            active: data.active !== false,
          };
        });
        return res.json({ success: true, fonctions: list });
      }

      return res.status(400).json({ success: false, error: "Action inconnue" });
    } catch (err) {
      console.error("Erreur fonctionsManagement:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// WhatsApp — Firestore trigger on alerts + admin config API
// =============================================

/**
 * onAlertCreated — Firestore trigger that sends WhatsApp for new alerts.
 */
const joursFeriesJob = require("../../../lib/joursFeries/joursFeries");

function buildJoursFeriesProdDeps() {
  const docRef = db_firestore.collection("app_settings").doc("jours_feries");
  return {
    fetchHolidays: (year) => joursFeriesJob.fetchAllHolidays(year),
    getExisting: async () => {
      const snap = await docRef.get();
      return snap.exists ? snap.data() : null;
    },
    saveDoc: (doc) => docRef.set(doc, { merge: true }),
    notify: async (n) => {
      const dateFr = (() => {
        try { return new Date(n.date + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "long" }); }
        catch (_) { return n.date; }
      })();
      const msg = n.dateChanged
        ? `📅 Jour férié « ${n.label} » : date mise à jour au ${dateFr} (était ${n.oldDate}).`
        : `📅 Jour férié « ${n.label} » confirmé pour le ${dateFr}.`;
      await dispatchNotification({
        type: "jour_ferie_update",
        profiles: ["rh", "dg"],
        channels: ["in_app"],
        data: { message: msg, severity: "info" },
        relatedDoc: "app_settings/jours_feries",
      });
    },
    nowIso: () => new Date().toISOString(),
    logger: (msg) => console.log(msg),
  };
}

exports.syncJoursFeries = functions
  .region(joursFeriesJob.CRON_CONFIG.region)
  .runWith({
    timeoutSeconds: joursFeriesJob.CRON_CONFIG.timeoutSeconds,
    memory: joursFeriesJob.CRON_CONFIG.memorySize,
  })
  .pubsub.schedule(joursFeriesJob.CRON_CONFIG.schedule)
  .timeZone(joursFeriesJob.CRON_CONFIG.timeZone)
  .onRun(async () => {
    const today = localDateStr();
    console.log("[syncJoursFeries] cron start date=" + today);
    try {
      const summary = await joursFeriesJob.runSyncJoursFeries(today, buildJoursFeriesProdDeps());
      console.log("[syncJoursFeries] cron done", JSON.stringify(summary));
    } catch (err) {
      console.error("[syncJoursFeries] cron error:", err.message);
    }
    return null;
  });

// HTTP trigger — one-shot manuel (auth requise, ?date=YYYY-MM-DD pour rejouer)
exports.runSyncJoursFeriesNow = functions
  .region(joursFeriesJob.HTTP_CONFIG.region)
  .runWith({
    timeoutSeconds: joursFeriesJob.HTTP_CONFIG.timeoutSeconds,
    memory: joursFeriesJob.HTTP_CONFIG.memorySize,
  })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const today = localDateStr();
    const date = (req.query && req.query.date) || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "date must be YYYY-MM-DD" });
    }
    try {
      const summary = await joursFeriesJob.runSyncJoursFeries(date, buildJoursFeriesProdDeps());
      return res.json({ success: true, ...summary });
    } catch (err) {
      console.error("[runSyncJoursFeriesNow] error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// bdpIntrospect — DIAGNOSTIC READ-ONLY de la BDP prod BEE_BERRY_GOOD.
// Lève le schéma brut des tables pointage AVANT d'écrire le pull.
// Protégé par ADMIN_SECRET (pas de Firebase Auth). Uniquement des SELECT.
// Appel : GET /api/bdp-introspect?secret=<ADMIN_SECRET>
//   ou header  x-admin-secret: <ADMIN_SECRET>
// Outil temporaire — à retirer après usage.
// ─────────────────────────────────────────────────────────────────────────────
const rhBdpService = require('../../../rhBdpService');

exports.rh = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === 'OPTIONS') return res.status(204).send('');

    // Auth Firebase requise
    const authUser = await requireAuth(req, res);
    if (!authUser) return; // requireAuth a déjà répondu 401

    // Rôle résolu côté serveur (token → users/{uid}), jamais depuis le body.
    const callerProfile = await resolveCallerProfile(authUser);
    const perim = consoAccessControl.resolvePerimetre(callerProfile, null);
    if (!paieAccess.canAccessDivers(perim)) {
      return res.status(403).json({ success: false, error: 'Accès non autorisé' });
    }

    const action = (req.query && req.query.action) || '';

    if (action === 'personnel-ref' && req.method === 'GET') {
      try {
        const result = await rhBdpService.getPersonnelRef();
        if (!result.success) {
          console.error('[rh] personnel-ref error:', result.error);
          return res.status(500).json({ success: false, error: result.error });
        }
        return res.json({ success: true, data: result.data, count: result.count });
      } catch (err) {
        console.error('[rh] personnel-ref unexpected error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(400).json({ success: false, error: 'Action inconnue ou méthode invalide' });
  });

// ─────────────────────────────────────────────────────────────────────────────
// campagneRapportHebdo — rapport Campagne (.xlsx) envoyé par WhatsApp tous les
// lundis à 16h00 (Africa/Casablanca).
//
// Ce bloc ne fait QUE le câblage : horaire, matrice de destinataires,
// dédoublonnage, verdict de succès et orchestration vivent dans
// lib/campagneRapportHebdo (module pur et testé). Les dépendances réelles
// (classeur + WhatsApp) sont injectées ici.
//
// Périmètre = la culture ENTIÈRE : `fermeFilter = null` à la génération et
// `ferme = null` à la résolution des destinataires — le chef F1 reçoit toutes
// les parcelles Framboise, toutes fermes confondues.
// ─────────────────────────────────────────────────────────────────────────────
