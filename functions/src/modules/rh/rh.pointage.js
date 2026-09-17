/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { paieAccess } = require("./_shared");
const { admin, bucket, consoAccessControl, db_firestore, functions, getPointageMeta, prodSync, requireAuth, resolveCallerProfile, resolveCallerRole, setCors, whatsappService} = require("../../shared/core");

const pointageValidationSM = require("../../../lib/pointageValidation/stateMachine");
const { authorizeValidationAction } = require("../../../lib/validation/validationAccess");
const pointageBdpSync = require("./pointageBdpSync");
const { comparePointage: comparePointageBdp } = require("../../../lib/pointageBdp/comparePointage");

// Sync récolte prod (Tracabilite_recolte) — toutes les 30 min de 11h à 20h
exports.syncPresenceEntree = functions.region("europe-west1").pubsub
  .schedule("*/15 9-11 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(() => prodSync.syncPresence("entree"));

// Sync présence sortie — retry toutes les 15min de 19h à 21h (résilience si BDP injoignable)
exports.syncPresenceSortie = functions.region("europe-west1").pubsub
  .schedule("*/15 19-21 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(() => prodSync.syncPresence("sortie"));

// Filet de sécurité + alerte — 21h15, après la fenêtre de retry sortie (19h-21h)
exports.checkPresenceSyncHealth = functions.region("europe-west1").pubsub
  .schedule("15 21 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    try {
      const result = await prodSync.checkPresenceSyncHealth();
      if (!result.success) {
        const recipients = await whatsappService.resolveRecipientsForProfile("dg", null);
        const today = new Date().toISOString().slice(0, 10);
        const msg = `Sync présence BDP en échec pour ${today} malgré les tentatives 9h-11h et 19h-21h. Erreur: ${result.error}. Vérifier le serveur BEE ONE (105.145.33.128).`;
        await Promise.all(
          (recipients || []).map((r) =>
            whatsappService.sendTemplateMessage(r.phone, "general_alert", [whatsappService.toSingleLine(msg)])
          )
        );
      }
    } catch (err) {
      console.error("[checkPresenceSyncHealth] error:", err.message);
    }
    return null;
  });

// Rappels 16h/17h/18h + escalade DG à 18h — soumission quotidienne des
// fichiers stock (Berry Good / Bahia). Voir docs/spec-collecte-stock-magasinier.md §4.4
// et functions/lib/stockFiles/reminders.js (logique pure + DI, testée en node:test).
exports.backfillPresence = functions.region("europe-west1")
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const src = req.method === "POST" ? (req.body || {}) : req.query;
    const startDate = src.startDate, endDate = src.endDate;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(startDate || "") || !dateRe.test(endDate || "")) {
      return res.status(400).json({ success: false, error: "startDate et endDate (YYYY-MM-DD) requis" });
    }
    const result = await prodSync.syncPresenceRange(startDate, endDate);
    return res.json(result);
  });

// Import & re-export backup functions
const pointageMod = require("./pointageService");
// Keep pointageRH/pointageRH2 exported to avoid GCP deletion issues
exports.pointageRH = pointageMod.pointageRH;
exports.pointageRH2 = pointageMod.pointageRH;
exports.warmPointageCache = pointageMod.warmPointageCache;
// Fresh function name to bypass GCP operation lock
exports.pointageV3 = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB", minInstances: 1 })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return pointageMod.pointageRH(req, res);
  });

// =============================================
// API: Validation Pointage du jour PAR ÉQUIPE / PAR FERME
// Route /api/pointage-validation (firebase.json → pointageValidation).
//
// Circuit (validé par Omar) :
//   RH valide/rejette chaque équipe + le Pointage Divers de la ferme
//   → RH soumet la ferme à SON Chef → Chef valide → FIGÉ (locked)
//   → DG peut déverrouiller.
//
// Collection Firestore : `pointage_validations_equipe`, 1 doc/jour, id=YYYY-MM-DD.
// (Collection DISTINCTE de `pointage_validations` qui héberge déjà le workflow
//  visaRH/Caporal/Chef par `${date}_${ferme}` — exports.validation — pour éviter
//  tout mélange de schéma.)
//
// Rôles résolus SERVEUR (resolveCallerRole, jamais depuis le body) :
//   - validate-equipe / validate-divers / submit-ferme : rh
//   - chef-validate-ferme : chef de LA ferme (chef_f1|chef_f5|chef_avo|chef_bahia)
//   - unlock-ferme : dg
// Mutations atomiques via runTransaction + gardes du state machine pur.
// =============================================
const POINTAGE_VALIDATION_FERMES = ['F1', 'F5', 'Avocatier', 'BAHIA'];

function emptyPointageValidationDoc(date) {
  return { date, fermes: {}, history: [], updated_at: null };
}

function emptyFermeValidationState() {
  return {
    equipes: {},
    divers: { status: 'na', motif: null, by: null, at: null },
    submitState: 'brouillon',
    soumis_by: null,
    soumis_at: null,
    chef_valide_by: null,
    chef_valide_at: null,
    locked: false,
  };
}

// Best-effort WhatsApp : envoie un texte à tous les destinataires d'un profil.
async function notifyProfilePointageValidation(profileId, ferme, text) {
  try {
    const recipients = await whatsappService.resolveRecipientsForProfile(profileId, ferme);
    if (!recipients || !recipients.length) return;
    await Promise.all(recipients.map((r) => whatsappService.sendTemplateMessage(r.phone, "general_alert", [whatsappService.toSingleLine(text)])));
  } catch (e) {
    console.error('[pointageValidation] WhatsApp notify failed:', profileId, e.message);
  }
}

exports.pointageValidation = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    const action = req.query.action || (req.body && req.body.action) || "";
    const collRef = db_firestore.collection("pointage_validations_equipe");

    try {
      // ---- GET : état du jour (tous profils authentifiés) ----
      if (action === "get-validations") {
        const date = req.query.date || (req.body && req.body.date);
        if (!date) return res.status(400).json({ success: false, error: "date requise" });
        const snap = await collRef.doc(date).get();
        const doc = snap.exists ? snap.data() : emptyPointageValidationDoc(date);
        return res.json({ success: true, validation: doc });
      }

      // Toutes les actions ci-dessous sont des mutations POST.
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "POST uniquement" });
      }

      const callerRole = await resolveCallerRole(authUser);
      const by = {
        uid: authUser.uid,
        name: (authUser.name || authUser.displayName || authUser.email || "").toString(),
        profileId: callerRole || null,
      };
      const { date, ferme } = req.body || {};
      if (!date || !ferme) return res.status(400).json({ success: false, error: "date et ferme requis" });
      if (POINTAGE_VALIDATION_FERMES.indexOf(ferme) < 0) {
        return res.status(400).json({ success: false, error: "ferme inconnue: " + ferme });
      }
      const docRef = collRef.doc(date);

      // ---- RH : valider/rejeter une équipe ----
      if (action === "validate-equipe") {
        if (callerRole !== "rh" && callerRole !== "dg") return res.status(403).json({ success: false, error: "Réservé au profil RH" });
        const { equipeId, status, motif } = req.body || {};
        if (!equipeId) return res.status(400).json({ success: false, error: "equipeId requis" });
        if (status !== "valide" && status !== "rejete") {
          return res.status(400).json({ success: false, error: "status invalide (valide|rejete)" });
        }
        const out = await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const doc = snap.exists ? snap.data() : emptyPointageValidationDoc(date);
          if (!doc.fermes) doc.fermes = {};
          if (!doc.fermes[ferme]) doc.fermes[ferme] = emptyFermeValidationState();
          const fermeState = doc.fermes[ferme];
          if (!pointageValidationSM.canValidateEquipe(fermeState)) {
            return { http: 409, body: { success: false, error: "Ferme soumise ou figée — saisie verrouillée" } };
          }
          if (!fermeState.equipes) fermeState.equipes = {};
          fermeState.equipes[equipeId] = { status, motif: motif || null, by, at: Date.now() };
          doc.updated_at = admin.firestore.FieldValue.serverTimestamp();
          const historyEntry = { action: "validate-equipe", ferme, equipeId, status, by, at: Date.now() };
          tx.set(docRef, doc, { merge: false });
          tx.update(docRef, { history: admin.firestore.FieldValue.arrayUnion(historyEntry) });
          return { http: 200, body: { success: true, validation: doc } };
        });
        return res.status(out.http).json(out.body);
      }

      // ---- RH : valider/rejeter le Pointage Divers de la ferme ----
      if (action === "validate-divers") {
        if (callerRole !== "rh" && callerRole !== "dg") return res.status(403).json({ success: false, error: "Réservé au profil RH" });
        const { status, motif } = req.body || {};
        if (["valide", "rejete", "na"].indexOf(status) < 0) {
          return res.status(400).json({ success: false, error: "status invalide (valide|rejete|na)" });
        }
        const out = await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const doc = snap.exists ? snap.data() : emptyPointageValidationDoc(date);
          if (!doc.fermes) doc.fermes = {};
          if (!doc.fermes[ferme]) doc.fermes[ferme] = emptyFermeValidationState();
          const fermeState = doc.fermes[ferme];
          if (!pointageValidationSM.canValidateEquipe(fermeState)) {
            return { http: 409, body: { success: false, error: "Ferme soumise ou figée — saisie verrouillée" } };
          }
          fermeState.divers = { status, motif: motif || null, by, at: Date.now() };
          doc.updated_at = admin.firestore.FieldValue.serverTimestamp();
          const historyEntry = { action: "validate-divers", ferme, status, by, at: Date.now() };
          tx.set(docRef, doc, { merge: false });
          tx.update(docRef, { history: admin.firestore.FieldValue.arrayUnion(historyEntry) });
          return { http: 200, body: { success: true, validation: doc } };
        });
        return res.status(out.http).json(out.body);
      }

      // ---- RH : soumettre la ferme à son chef ----
      if (action === "submit-ferme") {
        if (callerRole !== "rh" && callerRole !== "dg") return res.status(403).json({ success: false, error: "Réservé au profil RH" });
        const equipesDuJour = Array.isArray(req.body && req.body.equipesDuJour) ? req.body.equipesDuJour : [];
        const out = await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const doc = snap.exists ? snap.data() : emptyPointageValidationDoc(date);
          if (!doc.fermes) doc.fermes = {};
          if (!doc.fermes[ferme]) doc.fermes[ferme] = emptyFermeValidationState();
          const fermeState = doc.fermes[ferme];
          const check = pointageValidationSM.canSubmitFerme(fermeState, equipesDuJour);
          if (!check.ok) {
            const status = check.reason === "equipes_non_adressees" || check.reason === "divers_non_adresse" || check.reason === "aucune_equipe" ? 400 : 409;
            return { http: status, body: { success: false, error: "Soumission impossible: " + check.reason, manquantes: check.manquantes || [] } };
          }
          fermeState.submitState = "soumis";
          fermeState.soumis_by = by;
          fermeState.soumis_at = Date.now();
          doc.updated_at = admin.firestore.FieldValue.serverTimestamp();
          const historyEntry = { action: "submit-ferme", ferme, by, at: Date.now() };
          tx.set(docRef, doc, { merge: false });
          tx.update(docRef, { history: admin.firestore.FieldValue.arrayUnion(historyEntry) });
          return { http: 200, body: { success: true, validation: doc } };
        });
        if (out.http === 200) {
          const chefProfile = Object.keys(pointageValidationSM.CHEF_FERME_BY_PROFILE).find(
            (p) => pointageValidationSM.CHEF_FERME_BY_PROFILE[p] === ferme
          );
          if (chefProfile) {
            notifyProfilePointageValidation(
              chefProfile, ferme,
              `Pointage du ${date} — ferme ${ferme} soumis par le RH. Merci de valider dans l'app (Pointage du jour).`
            );
          }
        }
        return res.status(out.http).json(out.body);
      }

      // ---- Chef de LA ferme : valider (figer) ----
      if (action === "chef-validate-ferme") {
        // Pré-garde rôle/ferme : seul le chef de CETTE ferme peut valider.
        if (pointageValidationSM.fermeForChefProfile(callerRole) !== ferme) {
          const msg = pointageValidationSM.fermeForChefProfile(callerRole)
            ? "Vous n'êtes pas le Chef de cette ferme"
            : "Réservé au Chef de ferme";
          return res.status(403).json({ success: false, error: msg });
        }
        const out = await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const doc = snap.exists ? snap.data() : emptyPointageValidationDoc(date);
          if (!doc.fermes) doc.fermes = {};
          if (!doc.fermes[ferme]) doc.fermes[ferme] = emptyFermeValidationState();
          const fermeState = doc.fermes[ferme];
          const check = pointageValidationSM.canChefValidate(fermeState, ferme, callerRole);
          if (!check.ok) {
            const status = (check.reason === "pas_un_chef" || check.reason === "mauvaise_ferme") ? 403 : 409;
            const msg = check.reason === "pas_un_chef" ? "Réservé au Chef de ferme"
              : check.reason === "mauvaise_ferme" ? "Vous n'êtes pas le Chef de cette ferme"
                : "La ferme n'est pas en attente de validation Chef";
            return { http: status, body: { success: false, error: msg } };
          }
          fermeState.submitState = "valide";
          fermeState.locked = true;
          fermeState.chef_valide_by = by;
          fermeState.chef_valide_at = Date.now();
          doc.updated_at = admin.firestore.FieldValue.serverTimestamp();
          const historyEntry = { action: "chef-validate-ferme", ferme, by, at: Date.now() };
          tx.set(docRef, doc, { merge: false });
          tx.update(docRef, { history: admin.firestore.FieldValue.arrayUnion(historyEntry) });
          return { http: 200, body: { success: true, validation: doc } };
        });
        if (out.http === 200) {
          const msg = `Pointage du ${date} — ferme ${ferme} VALIDÉ et figé par le Chef.`;
          notifyProfilePointageValidation("rh", ferme, msg);
          notifyProfilePointageValidation("dg", ferme, msg);
        }
        return res.status(out.http).json(out.body);
      }

      // ---- Chef de LA ferme : rejeter (renvoyer au RH) ----
      if (action === "chef-reject-ferme") {
        // Pré-garde rôle/ferme : seul le chef de CETTE ferme peut rejeter.
        if (pointageValidationSM.fermeForChefProfile(callerRole) !== ferme) {
          const msg = pointageValidationSM.fermeForChefProfile(callerRole)
            ? "Vous n'êtes pas le Chef de cette ferme"
            : "Réservé au Chef de ferme";
          return res.status(403).json({ success: false, error: msg });
        }
        const motif = (req.body && req.body.motif) || null;
        const out = await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const doc = snap.exists ? snap.data() : emptyPointageValidationDoc(date);
          if (!doc.fermes) doc.fermes = {};
          if (!doc.fermes[ferme]) doc.fermes[ferme] = emptyFermeValidationState();
          const fermeState = doc.fermes[ferme];
          const check = pointageValidationSM.canChefReject(fermeState, ferme, callerRole);
          if (!check.ok) {
            const status = (check.reason === "pas_un_chef" || check.reason === "mauvaise_ferme") ? 403 : 409;
            const msg = check.reason === "pas_un_chef" ? "Réservé au Chef de ferme"
              : check.reason === "mauvaise_ferme" ? "Vous n'êtes pas le Chef de cette ferme"
                : "La ferme n'est pas en attente de validation Chef";
            return { http: status, body: { success: false, error: msg } };
          }
          // soumis → brouillon : rouvre la saisie RH (canValidateEquipe redevient vrai).
          fermeState.submitState = "brouillon";
          fermeState.locked = false;
          fermeState.chef_reject_by = by;
          fermeState.chef_reject_at = Date.now();
          fermeState.chef_reject_motif = motif;
          doc.updated_at = admin.firestore.FieldValue.serverTimestamp();
          const historyEntry = { action: "chef-reject-ferme", ferme, by, motif, at: Date.now() };
          tx.set(docRef, doc, { merge: false });
          tx.update(docRef, { history: admin.firestore.FieldValue.arrayUnion(historyEntry) });
          return { http: 200, body: { success: true, validation: doc } };
        });
        if (out.http === 200) {
          const motifTxt = motif ? ` Motif : ${motif}` : "";
          const msg = `Pointage du ${date} — ferme ${ferme} RENVOYÉ AU RH par le Chef.${motifTxt} La saisie RH est rouverte.`;
          notifyProfilePointageValidation("rh", ferme, msg);
          notifyProfilePointageValidation("dg", ferme, msg);
        }
        return res.status(out.http).json(out.body);
      }

      // ---- DG : déverrouiller (rouvre la saisie RH) ----
      if (action === "unlock-ferme") {
        if (callerRole !== "dg") return res.status(403).json({ success: false, error: "Réservé au DG" });
        const out = await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const doc = snap.exists ? snap.data() : emptyPointageValidationDoc(date);
          if (!doc.fermes) doc.fermes = {};
          if (!doc.fermes[ferme]) doc.fermes[ferme] = emptyFermeValidationState();
          const fermeState = doc.fermes[ferme];
          const check = pointageValidationSM.canUnlock(fermeState);
          if (!check.ok) {
            return { http: 409, body: { success: false, error: "Ferme non verrouillée — rien à déverrouiller" } };
          }
          fermeState.locked = false;
          fermeState.submitState = "brouillon";
          doc.updated_at = admin.firestore.FieldValue.serverTimestamp();
          const historyEntry = { action: "unlock-ferme", ferme, by, at: Date.now() };
          tx.set(docRef, doc, { merge: false });
          tx.update(docRef, { history: admin.firestore.FieldValue.arrayUnion(historyEntry) });
          return { http: 200, body: { success: true, validation: doc } };
        });
        if (out.http === 200) {
          const chefProfile = Object.keys(pointageValidationSM.CHEF_FERME_BY_PROFILE).find(
            (p) => pointageValidationSM.CHEF_FERME_BY_PROFILE[p] === ferme
          );
          const msg = `Pointage du ${date} — ferme ${ferme} DÉVERROUILLÉ par le DG. La saisie RH est rouverte.`;
          notifyProfilePointageValidation("rh", ferme, msg);
          if (chefProfile) notifyProfilePointageValidation(chefProfile, ferme, msg);
        }
        return res.status(out.http).json(out.body);
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur pointageValidation:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Écarts & Défauts (Firestore CRUD)
// Collection: ecarts_pesages, ecarts_config
// =============================================
exports.validation = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const action = req.query.action || (req.body && req.body.action);

      // Delegate pointage-rh actions to pointageService
      const pointageActions = ['summary', 'detail', 'dates', 'recolte', 'hors-recolte', 'recolte-equipes', 'quinzaine', 'quinzaine-analytique', 'quinzaine-repos', 'quinzaine-alertes', 'upload-times', 'postes-fixes', 'suivi-tunnels', 'presence'];
      if (pointageActions.includes(action)) {
        const { pointageRH } = require("./pointageService");
        return pointageRH(req, res);
      }

      // GET status for a date + ferme
      if (action === "status") {
        const date = req.query.date;
        const ferme = req.query.ferme;
        if (!date) return res.status(400).json({ success: false, error: "date required" });

        if (ferme) {
          const docId = `${date}_${ferme}`;
          const snap = await db_firestore.collection("pointage_validations").doc(docId).get();
          return res.json({ success: true, validation: snap.exists ? snap.data() : null });
        }

        // Return all fermes for the date
        const snaps = await db_firestore.collection("pointage_validations")
          .where("date", "==", date).get();
        const validations = {};
        snaps.forEach(doc => { validations[doc.data().ferme] = doc.data(); });
        return res.json({ success: true, validations });
      }

      // POST validate
      if (action === "validate") {
        // SÉCURITÉ : role/profileId du body sont IGNORÉS — identité résolue serveur.
        const { date, ferme, comment } = req.body || {};
        if (!date || !ferme) return res.status(400).json({ success: false, error: "date, ferme required" });

        const callerProfile = await resolveCallerRole(authUser);
        const dec = authorizeValidationAction({ callerProfile, action: "validate", ferme });
        if (!dec.allowed) return res.status(403).json({ success: false, error: dec.reason });
        const role = dec.role;

        const docId = `${date}_${ferme}`;
        const docRef = db_firestore.collection("pointage_validations").doc(docId);
        const snap = await docRef.get();
        const current = snap.exists ? snap.data() : { date, ferme, visaRH: null, visaCaporal: null, visaChef: null, locked: false };

        const visa = { validatedBy: callerProfile, validatedAt: Date.now(), comment: comment || "" };

        if (role === "rh") {
          if (ferme === "DIVERS") {
            // Snapshot = freeze Firestore divers entries
            const diversDoc = await db_firestore.collection("pointage_divers").doc(date).get();
            const diversData = diversDoc.exists ? diversDoc.data() : { entries: [] };
            await db_firestore.collection("pointage_snapshots").doc(docId).set({
              ...diversData, snapshotAt: Date.now(), snapshotBy: callerProfile,
            });
            current.workerCount = (diversData.entries || []).length;
          } else {
            // Create snapshot of SQL data (freeze data at submission time)
            const { createSnapshot } = require("./pointageService");
            const snapshotData = await createSnapshot(date, ferme, callerProfile);
            current.workerCount = snapshotData.workerCount || 0;
          }
          current.visaRH = visa;
          current.snapshotId = docId;
          // Clear rejection fields if re-submitting after rejection
          current.rejected = false;
          current.rejectedBy = null;
          current.rejectedAt = null;
          current.rejectionComment = null;
          current.rejectionRole = null;
        } else if (role === "caporal") {
          if (!current.visaRH) return res.status(400).json({ success: false, error: "RH doit soumettre avant le Caporal" });
          const pieceJointeUrl = (req.body || {}).pieceJointeUrl;
          const pieceJointeFilename = (req.body || {}).pieceJointeFilename;
          if (!pieceJointeUrl) return res.status(400).json({ success: false, error: "Pièce jointe obligatoire (scan du pointage papier)" });
          current.visaCaporal = visa;
          current.pieceJointeUrl = pieceJointeUrl;
          current.pieceJointeFilename = pieceJointeFilename || "";
        } else if (role === "chef") {
          if (!current.visaRH) return res.status(400).json({ success: false, error: "RH doit soumettre d'abord" });
          if (!current.visaCaporal) return res.status(400).json({ success: false, error: "Caporal doit valider avant le Chef" });
          current.visaChef = visa;
          current.locked = true;
        } else {
          return res.status(400).json({ success: false, error: "Role inconnu: " + role });
        }

        current.updatedAt = Date.now();
        await docRef.set(current);
        return res.json({ success: true, validation: current });
      }

      // POST reject (Caporal or Chef)
      if (action === "reject") {
        // SÉCURITÉ : role/profileId du body sont IGNORÉS — identité résolue serveur.
        const { date, ferme, comment } = req.body || {};
        if (!date || !ferme || !comment) return res.status(400).json({ success: false, error: "date, ferme, comment required" });

        const callerProfile = await resolveCallerRole(authUser);
        const dec = authorizeValidationAction({ callerProfile, action: "reject", ferme });
        if (!dec.allowed) return res.status(403).json({ success: false, error: dec.reason });
        const role = dec.role;

        const docId = `${date}_${ferme}`;
        const docRef = db_firestore.collection("pointage_validations").doc(docId);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Validation introuvable" });

        const current = snap.data();

        if (role === "caporal") {
          if (!current.visaRH) return res.status(400).json({ success: false, error: "Rien à rejeter" });
          if (current.visaCaporal) return res.status(400).json({ success: false, error: "Déjà validé par le Caporal" });
          // Reset RH visa — RH must re-verify and re-submit
          current.visaRH = null;
        } else if (role === "chef") {
          if (!current.visaCaporal) return res.status(400).json({ success: false, error: "Caporal n'a pas encore validé" });
          if (current.visaChef) return res.status(400).json({ success: false, error: "Déjà validé par le Chef" });
          // Reset caporal visa — caporal must re-validate
          current.visaCaporal = null;
        } else {
          return res.status(400).json({ success: false, error: "Seul le Caporal ou Chef peut rejeter" });
        }

        current.locked = false;
        current.rejected = true;
        current.rejectedBy = callerProfile;
        current.rejectedAt = Date.now();
        current.rejectionComment = comment;
        current.rejectionRole = role;
        current.updatedAt = Date.now();
        // Snapshot is KEPT — data remains frozen for RH to review/edit

        await docRef.set(current);
        return res.json({ success: true, validation: current });
      }

      // POST unlock (RH only, or DG override)
      if (action === "unlock") {
        // SÉCURITÉ : profileId du body est IGNORÉ — identité résolue serveur.
        const { date, ferme } = req.body || {};
        if (!date || !ferme) return res.status(400).json({ success: false, error: "date, ferme required" });

        const callerProfile = await resolveCallerRole(authUser);
        const docId = `${date}_${ferme}`;
        const docRef = db_firestore.collection("pointage_validations").doc(docId);

        // Guard: only DG can unlock a validated (locked & not rejected) pointage.
        // locked/rejected lus de l'état serveur, décision serveur (jamais profileId du body).
        const existingSnap = await docRef.get();
        const existing = existingSnap.exists ? existingSnap.data() : {};
        const dec = authorizeValidationAction({
          callerProfile,
          action: "unlock",
          ferme,
          locked: existing.locked === true,
          rejected: existing.rejected === true,
        });
        if (!dec.allowed) return res.status(403).json({ success: false, error: dec.reason });

        await docRef.set({ date, ferme, visaRH: null, visaCaporal: null, visaChef: null, locked: false, rejected: false, rejectedBy: null, rejectedAt: null, rejectionComment: null, rejectionRole: null, pieceJointeUrl: null, pieceJointeFilename: null, updatedAt: Date.now() });
        // Delete snapshot — return to SQL as data source
        await db_firestore.collection("pointage_snapshots").doc(docId).delete().catch(() => {});
        return res.json({ success: true, message: "Déverrouillé" });
      }

      // GET quinzaine-status: validation status for all dates in a quinzaine
      if (action === "quinzaine-status") {
        const metaSnap = await db_firestore.collection("sql_mirror_pointage_meta").doc("config").get();
        if (!metaSnap.exists) return res.json({ success: true, periodes: [], dates: [], validations: {} });
        const meta = metaSnap.data();
        const periodes = meta.periodes || [];
        const periodeMap = meta.periodeMap || {};
        const periodeCampagne = meta.periodeCampagne || {};
        // Défaut = 1re quinzaine de la campagne courante (fallback gracieux si absent).
        const { defaultPeriodeForCampagne } = require("../../../lib/pointage/campagnePeriodes");
        const { campagneCourante } = require("../../../lib/mappingConso/campagneUtils");
        const selectedPeriode = req.query.periode || defaultPeriodeForCampagne(periodes, periodeCampagne, campagneCourante()) || "";
        const dates = (periodeMap[selectedPeriode] || []).sort();
        if (!dates.length) return res.json({ success: true, periodes, periodeCampagne, selectedPeriode, dates: [], validations: {} });

        // Firestore 'in' supports up to 30 values — quinzaines have ~15 days
        const valSnaps = await db_firestore.collection("pointage_validations")
          .where("date", "in", dates).get();
        const validations = {};
        dates.forEach(d => { validations[d] = {}; });
        valSnaps.forEach(doc => {
          const v = doc.data();
          if (!validations[v.date]) validations[v.date] = {};
          validations[v.date][v.ferme] = v;
        });
        return res.json({ success: true, periodes, periodeCampagne, selectedPeriode, dates, validations });
      }

      // GET sql-comparison: compare SQL mirror vs snapshot for locked days
      if (action === "sql-comparison") {
        const metaSnap = await db_firestore.collection("sql_mirror_pointage_meta").doc("config").get();
        if (!metaSnap.exists) return res.json({ success: true, comparisons: [] });
        const meta = metaSnap.data();
        const periodes = meta.periodes || [];
        const periodeMap = meta.periodeMap || {};
        const selectedPeriode = req.query.periode || periodes[0] || "";
        const dates = (periodeMap[selectedPeriode] || []).sort();

        // Find locked validations
        const valSnaps = await db_firestore.collection("pointage_validations")
          .where("date", "in", dates.length ? dates : ["__none__"]).get();
        const lockedItems = [];
        valSnaps.forEach(doc => {
          const v = doc.data();
          if (v.locked) lockedItems.push({ date: v.date, ferme: v.ferme });
        });

        const { deriveFerme } = require("./pointageService");
        const comparisons = [];
        for (const item of lockedItems) {
          // Load SQL mirror
          const sqlSnap = await db_firestore.collection("sql_mirror_pointage").doc(item.date).get();
          const sqlRows = sqlSnap.exists ? (sqlSnap.data().rows || []) : [];
          const sqlFermeRows = sqlRows.filter(r => deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) === item.ferme);
          const sqlRowCount = sqlFermeRows.length;
          const sqlTotalCout = sqlFermeRows.reduce((s, r) => s + (parseFloat(r.Cout) || 0), 0);
          const sqlWorkers = new Set(sqlFermeRows.map(r => r.Personnel_Matricule)).size;

          // Load snapshot
          const snapDoc = await db_firestore.collection("pointage_snapshots").doc(`${item.date}_${item.ferme}`).get();
          const snapData = snapDoc.exists ? snapDoc.data() : {};
          const snapRows = snapData.detailRows || [];
          const snapRowCount = snapRows.length;
          const snapTotalCout = snapRows.reduce((s, r) => s + (parseFloat(r.Cout) || 0), 0);
          const snapWorkers = new Set(snapRows.map(r => r.Personnel_Matricule)).size;

          comparisons.push({
            date: item.date, ferme: item.ferme,
            sql: { rowCount: sqlRowCount, totalCout: Math.round(sqlTotalCout * 100) / 100, workerCount: sqlWorkers },
            snapshot: { rowCount: snapRowCount, totalCout: Math.round(snapTotalCout * 100) / 100, workerCount: snapWorkers },
            match: sqlRowCount === snapRowCount && Math.abs(sqlTotalCout - snapTotalCout) < 1
          });
        }
        return res.json({ success: true, comparisons });
      }

      // POST upload-attachment: upload pointage paper scan for Caporal
      if (action === "upload-attachment") {
        if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST uniquement" });
        const { date, ferme, file_base64, filename, contentType } = req.body || {};
        if (!date || !ferme || !file_base64) return res.status(400).json({ success: false, error: "date, ferme, file_base64 required" });
        const buffer = Buffer.from(file_base64.replace(/^data:[^;]+;base64,/, ""), "base64");
        const ext = (filename || "scan.jpg").split(".").pop() || "jpg";
        const storagePath = `pointage_attachments/${date}_${ferme}/${Date.now()}.${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType: contentType || `image/${ext}` } });
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        return res.json({ success: true, url: publicUrl, filename: filename || `scan.${ext}` });
      }

      // ------ TRANSPORT CONFIG: list, submit changes, approve/reject by finance ------
      // GET: action=transport-config → list current config + pending changes
      if (action === "transport-config") {
        const configSnap = await db_firestore.collection("transport_config").orderBy("prefix").get();
        const config = [];
        configSnap.forEach(doc => config.push({ id: doc.id, ...doc.data() }));

        const pendingSnap = await db_firestore.collection("transport_config_changes")
          .where("status", "==", "en_attente").orderBy("createdAt", "desc").get();
        const pending = [];
        pendingSnap.forEach(doc => pending.push({ id: doc.id, ...doc.data() }));

        return res.json({ success: true, config, pendingChanges: pending });
      }

      // POST: action=transport-config-init → initialize Firestore from array (one-time setup)
      if (action === "transport-config-init" && req.method === "POST") {
        const { equipes } = req.body || {};
        if (!equipes || !Array.isArray(equipes)) return res.status(400).json({ success: false, error: "equipes array required" });
        const batch = db_firestore.batch();
        for (const eq of equipes) {
          const ref = db_firestore.collection("transport_config").doc(eq.prefix);
          batch.set(ref, { prefix: eq.prefix, equipe: eq.equipe, caporal: eq.caporal, coutParOuvrier: eq.coutParOuvrier, updatedAt: Date.now() });
        }
        await batch.commit();
        return res.json({ success: true, message: `${equipes.length} équipes initialisées` });
      }

      // POST: action=transport-config-submit → RH submits a change request (pending finance approval)
      if (action === "transport-config-submit" && req.method === "POST") {
        const { changeType, data: changeData, submittedBy } = req.body || {};
        // changeType: "modifier_prix" | "ajouter_equipe" | "supprimer_equipe"
        if (!changeType || !changeData) return res.status(400).json({ success: false, error: "changeType and data required" });

        const docRef = db_firestore.collection("transport_config_changes").doc();
        await docRef.set({
          changeType,
          data: changeData,
          submittedBy: submittedBy || "RH",
          status: "en_attente",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        return res.json({ success: true, id: docRef.id, message: "Demande soumise, en attente de validation Finance" });
      }

      // POST: action=transport-config-apply → RH applies a change DIRECTLY (no Finance validation)
      // Source de vérité unique : rh_config/transport_primes (même schéma versionné que l'onglet DG « Équipes »).
      // Notifie le DG par WhatsApp en cas d'AUGMENTATION de tarif (fire-and-forget).
      if (action === "transport-config-apply" && req.method === "POST") {
        const { changeType, data: changeData, effectiveFrom } = req.body || {};
        // changeType: "modifier_prix" | "ajouter_equipe" | "supprimer_equipe"
        if (!changeType || !changeData || !changeData.prefix) {
          return res.status(400).json({ success: false, error: "changeType et data.prefix requis" });
        }
        if (changeType !== "supprimer_equipe" && !effectiveFrom) {
          return res.status(400).json({ success: false, error: "effectiveFrom (quinzaine) requis" });
        }
        const prefix = String(changeData.prefix).toUpperCase();
        const updatedBy = (authUser && authUser.email) || "RH";
        const docRef = db_firestore.collection("rh_config").doc("transport_primes");

        await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const equipes = (snap.exists && Array.isArray(snap.data().equipes)) ? snap.data().equipes : [];
          const idx = equipes.findIndex(e => e && e.prefix === prefix);

          if (changeType === "supprimer_equipe") {
            if (idx >= 0) equipes.splice(idx, 1);
          } else {
            const newCout = Number(changeType === "modifier_prix" ? changeData.newCout : changeData.coutParOuvrier);
            const entry = { effectiveFrom, coutParOuvrier: newCout, updatedAt: new Date().toISOString(), updatedBy };
            if (idx >= 0) {
              const t = equipes[idx];
              const history = (Array.isArray(t.history) ? t.history : [])
                .filter(h => !(h.effectiveFrom === effectiveFrom && h.coutParOuvrier === newCout));
              history.push(entry);
              equipes[idx] = {
                prefix,
                equipe: changeData.equipe || t.equipe || prefix,
                caporal: changeData.caporal != null ? changeData.caporal : (t.caporal || ""),
                ferme: changeData.ferme != null ? changeData.ferme : (t.ferme || ""),
                history,
              };
            } else {
              equipes.push({
                prefix,
                equipe: changeData.equipe || prefix,
                caporal: changeData.caporal || "",
                ferme: changeData.ferme || "",
                history: [entry],
              });
            }
          }

          tx.set(docRef, {
            equipes,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy,
          }, { merge: false });
        });

        // Alerte DG en cas d'augmentation. La modif est déjà persistée (transaction ci-dessus) :
        // on attend l'envoi pour garantir la livraison (CF peut geler l'instance après la réponse),
        // mais un échec d'envoi ne remet jamais en cause la modif.
        if (changeType === "modifier_prix") {
          const oldCout = Number(changeData.oldCout);
          const newCout = Number(changeData.newCout);
          if (!isNaN(oldCout) && !isNaN(newCout) && newCout > oldCout) {
            const equipeLbl = changeData.equipe ? `${prefix} (${changeData.equipe})` : prefix;
            const message = `Augmentation tarif transport — équipe ${equipeLbl} : ${oldCout} → ${newCout} MAD/ouvrier, à partir de ${effectiveFrom} (par ${updatedBy})`;
            try {
              const recipients = await whatsappService.resolveRecipientsForProfile("dg", null);
              await Promise.allSettled(
                recipients.map(r => whatsappService.sendTemplateMessage(r.phone, "general_alert", [message]))
              );
            } catch (e) {
              console.error("[transport-config-apply] WhatsApp DG notification failed:", e && e.message);
            }
          }
        }

        return res.json({ success: true, message: "Tarif appliqué" });
      }

      // POST: action=transport-config-validate → Finance approves or rejects
      if (action === "transport-config-validate" && req.method === "POST") {
        const { changeId, decision, validatedBy, comment } = req.body || {};
        // decision: "approuver" | "rejeter"
        if (!changeId || !decision) return res.status(400).json({ success: false, error: "changeId and decision required" });

        const changeRef = db_firestore.collection("transport_config_changes").doc(changeId);
        const changeSnap = await changeRef.get();
        if (!changeSnap.exists) return res.status(404).json({ success: false, error: "Demande introuvable" });
        const change = changeSnap.data();
        if (change.status !== "en_attente") return res.status(400).json({ success: false, error: "Demande déjà traitée" });

        if (decision === "approuver") {
          // Apply the change to transport_config collection
          const d = change.data;
          if (change.changeType === "modifier_prix") {
            await db_firestore.collection("transport_config").doc(d.prefix).update({ coutParOuvrier: d.newCout, updatedAt: Date.now() });
          } else if (change.changeType === "ajouter_equipe") {
            await db_firestore.collection("transport_config").doc(d.prefix).set({
              prefix: d.prefix, equipe: d.equipe, caporal: d.caporal, coutParOuvrier: d.coutParOuvrier, updatedAt: Date.now(),
            });
          } else if (change.changeType === "supprimer_equipe") {
            await db_firestore.collection("transport_config").doc(d.prefix).delete();
          }
          await changeRef.update({ status: "approuvée", validatedBy: validatedBy || "Finance", validatedAt: Date.now(), comment: comment || "" });
          return res.json({ success: true, message: "Changement approuvé et appliqué" });
        } else {
          await changeRef.update({ status: "rejetée", validatedBy: validatedBy || "Finance", validatedAt: Date.now(), comment: comment || "" });
          return res.json({ success: true, message: "Changement rejeté" });
        }
      }

      // ------ POINTAGE DIVERS (DVR): config CRUD + daily entries ------

      // ONE-TIME SEED: populate initial divers config from DVR Excel (remove after use)
      if (action === "divers-seed") {
        const existing = await db_firestore.collection("pointage_divers_config").where("active", "==", true).limit(1).get();
        if (!existing.empty) return res.json({ success: true, message: "Déjà initialisé", count: 0 });
        const items = [
          { beneficiaire: "KADOUR DEBAZ TRAC", fonction: "TRACTEUR", tache: "NETTIYAGE F5", prixUnitaire: 450, unite: "JOUR" },
          { beneficiaire: "REFISSA TRAC", fonction: "TRACTEUR", tache: "Traitement Avocat", prixUnitaire: 450, unite: "JOUR" },
          { beneficiaire: "EL MESBAHI AHMED", fonction: "TRS", tache: "TRS OUVRIRE F6", prixUnitaire: 400, unite: "JOUR" },
          { beneficiaire: "MOHAMED JCB", fonction: "JCB", tache: "CHAREGEMENT", prixUnitaire: 250, unite: "HEURE" },
          { beneficiaire: "EL MAJDOUBI MUSTAPHA", fonction: "TRACTEUR", tache: "NETTIYAGE F5", prixUnitaire: 450, unite: "VOYAGES" },
          { beneficiaire: "HAMAMOU HAMZA", fonction: "TRACTEUR", tache: "Réparation de la route F1", prixUnitaire: 400, unite: "JOUR" },
          { beneficiaire: "RAGRAGUI BRAHIM", fonction: "TRS", tache: "TRS D'emballage F1", prixUnitaire: 100, unite: "VOYAGES" },
          { beneficiaire: "KRIDECHE MOHAMED", fonction: "TRS", tache: "TRS D'emballage F5", prixUnitaire: 200, unite: "VOYAGES" },
          { beneficiaire: "RAGRAGUI BRAHIM", fonction: "TRS", tache: "TRS D'emballage F5", prixUnitaire: 100, unite: "VOYAGES" },
          { beneficiaire: "EL SEGHIRE BACHIR", fonction: "TRS", tache: "TRS D'emballage F5", prixUnitaire: 150, unite: "VOYAGES" },
          { beneficiaire: "KRIDECHE MOHAMED", fonction: "TRS FRUITS", tache: "TRS FRUITS", prixUnitaire: 500, unite: "VOYAGES" },
        ];
        const batch = db_firestore.batch();
        items.forEach(item => {
          const ref = db_firestore.collection("pointage_divers_config").doc();
          batch.set(ref, { ...item, active: true, createdAt: Date.now(), updatedAt: Date.now() });
        });
        await batch.commit();
        return res.json({ success: true, message: items.length + " sous-traitants créés", count: items.length });
      }

      // GET: list active divers config items
      // Pas de .orderBy("beneficiaire") ici : combiné au .where("active","==",true)
      // il exige un index composite (FAILED_PRECONDITION) → on trie en JS.
      if (action === "divers-config") {
        const snap = await db_firestore.collection("pointage_divers_config").where("active", "==", true).get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        items.sort((a, b) => String(a.beneficiaire || "").localeCompare(String(b.beneficiaire || "")));
        return res.json({ success: true, items });
      }

      // POST: create or update a divers config item
      if (action === "divers-config-save" && req.method === "POST") {
        const { id, beneficiaire, matricule, fonction, tache, prixUnitaire, unite } = req.body || {};
        if (!beneficiaire || !fonction || !tache || !prixUnitaire || !unite) {
          return res.status(400).json({ success: false, error: "beneficiaire, fonction, tache, prixUnitaire, unite required" });
        }
        const data = { beneficiaire: beneficiaire.trim(), matricule: String(matricule || "").trim().toUpperCase(), fonction: fonction.trim(), tache: tache.trim(), prixUnitaire: Number(prixUnitaire), unite: unite.trim(), active: true, updatedAt: Date.now() };
        if (id) {
          await db_firestore.collection("pointage_divers_config").doc(id).update(data);
          return res.json({ success: true, id, message: "Mis à jour" });
        } else {
          data.createdAt = Date.now();
          const ref = await db_firestore.collection("pointage_divers_config").add(data);
          return res.json({ success: true, id: ref.id, message: "Créé" });
        }
      }

      // POST: soft-delete a divers config item
      if (action === "divers-config-delete" && req.method === "POST") {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ success: false, error: "id required" });
        await db_firestore.collection("pointage_divers_config").doc(id).update({ active: false, updatedAt: Date.now() });
        return res.json({ success: true, message: "Supprimé" });
      }

      // ── Jours fériés Maroc — source unique app_settings/jours_feries ──
      // GET: liste des fériés (calendrier RH + éditeur)
      if (action === "jours-feries") {
        const snap = await db_firestore.collection("app_settings").doc("jours_feries").get();
        const data = snap.exists ? snap.data() : {};
        return res.json({
          success: true,
          holidays: Array.isArray(data.holidays) ? data.holidays : [],
          lastSyncAt: data.lastSyncAt || null,
          syncSource: data.syncSource || null,
        });
      }

      // POST: upsert RH d'un férié (override = vérité finale, jamais écrasé par le job)
      if (action === "jours-feries-save" && req.method === "POST") {
        const { originalDate, date, label, type, status } = req.body || {};
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !label) {
          return res.status(400).json({ success: false, error: "date (YYYY-MM-DD) et label requis" });
        }
        const t = (type === "islamique") ? "islamique" : "fixe";
        const st = ["fixe", "estime", "confirme"].includes(status) ? status : (t === "fixe" ? "fixe" : "confirme");
        const nowIso = new Date().toISOString();
        const ref = db_firestore.collection("app_settings").doc("jours_feries");
        await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const cur = snap.exists ? snap.data() : {};
          const holidays = Array.isArray(cur.holidays) ? cur.holidays.slice() : [];
          const matchDate = originalDate || date;
          const idx = holidays.findIndex(h => h.date === matchDate);
          const entry = {
            date, label: label.trim(), type: t, status: st,
            source: "rh", manualOverride: true, updatedAt: nowIso,
          };
          if (idx >= 0) holidays[idx] = Object.assign({}, holidays[idx], entry);
          else holidays.push(entry);
          holidays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
          tx.set(ref, { holidays, updatedAt: nowIso }, { merge: true });
        });
        return res.json({ success: true, message: originalDate ? "Mis à jour" : "Créé" });
      }

      // POST: suppression RH d'un férié par date
      if (action === "jours-feries-delete" && req.method === "POST") {
        const { date } = req.body || {};
        if (!date) return res.status(400).json({ success: false, error: "date requise" });
        const nowIso = new Date().toISOString();
        const ref = db_firestore.collection("app_settings").doc("jours_feries");
        await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const cur = snap.exists ? snap.data() : {};
          const holidays = (Array.isArray(cur.holidays) ? cur.holidays : []).filter(h => h.date !== date);
          tx.set(ref, { holidays, updatedAt: nowIso }, { merge: true });
        });
        return res.json({ success: true, message: "Supprimé" });
      }

      // GATING PAIE (Étape 0) — la sous-traitance nominative (pointage_divers)
      // n'a PAS de champ ferme → non cloisonnable. Accès réservé aux profils
      // full-access (dg/finance/rh/admin). Chef (ferme spécifique) ou tout autre
      // profil → 403 AVANT toute lecture Firestore (fail-closed). Rôle résolu
      // SERVEUR depuis users/{uid} (token), jamais depuis le body.
      if (action === "divers-entries" || action === "divers-entries-range") {
        const callerProfile = await resolveCallerProfile(authUser);
        const perimDivers = consoAccessControl.resolvePerimetre(callerProfile, null);
        if (!paieAccess.canAccessDivers(perimDivers)) {
          return res.status(403).json({ success: false, error: "Accès non autorisé" });
        }
      }

      // GET: get divers entries for a specific date
      if (action === "divers-entries") {
        const date = req.query.date;
        if (!date) return res.status(400).json({ success: false, error: "date required" });
        const doc = await db_firestore.collection("pointage_divers").doc(date).get();
        return res.json({ success: true, data: doc.exists ? doc.data() : { date, entries: [], totalMontant: 0 } });
      }

      // GET: divers entries for a whole quinzaine (vue quinzaine + carte récap)
      if (action === "divers-entries-range") {
        const meta = await getPointageMeta();
        const periodes = (meta && meta.periodes) || [];
        const periodeMap = (meta && meta.periodeMap) || {};
        const periodeCampagne = (meta && meta.periodeCampagne) || {};
        const { defaultPeriodeForCampagne } = require("../../../lib/pointage/campagnePeriodes");
        const { campagneCourante } = require("../../../lib/mappingConso/campagneUtils");
        let periode = req.query.periode;
        if (!periode || !periodeMap[periode]) {
          const d = req.query.date;
          // Défaut = 1re quinzaine de la campagne courante (fallback gracieux si absent).
          periode = (d && periodes.find(p => (periodeMap[p] || []).includes(d)))
            || defaultPeriodeForCampagne(periodes, periodeCampagne, campagneCourante())
            || null;
        }
        // Plage CALENDAIRE complète de la quinzaine (pas seulement les jours de production),
        // pour capter les saisies divers manuelles sur des jours sans pointage production.
        const shiftD = (ds, n) => { const x = new Date(ds + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
        const pDays = (periode && periodeMap[periode] ? periodeMap[periode] : []).slice().sort();
        const dates = [];
        if (pDays.length) {
          const start = pDays[0];
          const idxP = periodes.indexOf(periode);
          const newerDays = (idxP > 0 ? (periodeMap[periodes[idxP - 1]] || []) : []).slice().sort(); // periodes triés DESC → idx-1 = quinzaine plus récente
          const end = newerDays.length ? shiftD(newerDays[0], -1) : shiftD(start, 15);
          for (let d = start; d <= end; d = shiftD(d, 1)) dates.push(d);
        }
        const byDate = {};
        for (let i = 0; i < dates.length; i += 10) {
          const batch = dates.slice(i, i + 10);
          const snaps = await Promise.all(batch.map(dd => db_firestore.collection("pointage_divers").doc(dd).get()));
          snaps.forEach((s, idx) => {
            const dd = batch[idx];
            const data = s.exists ? s.data() : null;
            byDate[dd] = { entries: (data && data.entries) || [], totalMontant: (data && data.totalMontant) || 0 };
          });
        }
        return res.json({ success: true, periodes, periodeCampagne, periode, dates, byDate });
      }

      // POST: save divers entries for a date (blocked if locked)
      if (action === "divers-entries-save" && req.method === "POST") {
        const { date, entries, profileId } = req.body || {};
        if (!date || !entries) return res.status(400).json({ success: false, error: "date, entries required" });

        // Check if locked
        const valDoc = await db_firestore.collection("pointage_validations").doc(`${date}_DIVERS`).get();
        if (valDoc.exists && valDoc.data().locked) {
          return res.status(403).json({ success: false, error: "Pointage verrouillé pour cette date" });
        }

        const cleanEntries = entries.map(e => ({
          configId: e.configId || "",
          beneficiaire: (e.beneficiaire || "").trim(),
          matricule: (e.matricule || "").trim(),
          fonction: (e.fonction || "").trim(),
          tache: (e.tache || "").trim(),
          quantite: Number(e.quantite) || 0,
          prixUnitaire: Number(e.prixUnitaire) || 0,
          unite: (e.unite || "").trim(),
          montant: Math.round((Number(e.quantite) || 0) * (Number(e.prixUnitaire) || 0) * 100) / 100,
          commentaire: (e.commentaire || "").trim(),
        }));
        const totalMontant = Math.round(cleanEntries.reduce((s, e) => s + e.montant, 0) * 100) / 100;

        await db_firestore.collection("pointage_divers").doc(date).set({
          date, entries: cleanEntries, totalMontant,
          createdBy: profileId || "rh", updatedAt: Date.now(),
        });
        return res.json({ success: true, totalMontant, count: cleanEntries.length });
      }

      return res.status(400).json({ success: false, error: "Action inconnue" });
    } catch (err) {
      console.error("Erreur Validation:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Stock Management (Achats, BDC, BL, Factures, BC)
// Collections: suppliers, purchase_orders, delivery_notes, invoices, consumption_vouchers, stock_config
// =============================================

// Helper: generate sequential number with Firestore transaction
exports.syncPointageBdpTrigger = functions
  .region("europe-west1")
  .runWith({ secrets: ["ADMIN_SECRET"], timeoutSeconds: 300, memory: "512MB" })
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
      const from = (req.query && req.query.from) || undefined;
      const to = (req.query && req.query.to) || undefined;
      const result = await pointageBdpSync.syncPointageFromProd(db_firestore, { from, to });
      return res.status(result.success ? 200 : 500).json(result);
    } catch (err) {
      console.error("[syncPointageBdpTrigger] error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// backfillPointageBdpLiveTrigger — P3 : BACKFILL LIVE du pointage FACTUEL BDP.
// ⚠️ ÉCRITURE LIVE SENSIBLE. Écrit dans le mirror LIVE `sql_mirror_pointage`
// (pas le témoin) + reconstruit le meta + workers pour rendre la quinzaine
// visible dans le dropdown. Borné à la plage [from, to] (upsert), ne supprime
// rien, n'écrase aucune date hors plage. Idempotent.
// GARDE-FOUS : ADMIN_SECRET + confirm=LIVE explicite + plage ≤ 40 jours.
// Appel : GET /api/backfill-pointage-bdp-live
//   ?secret=<ADMIN_SECRET>&from=YYYY-MM-DD&to=YYYY-MM-DD&confirm=LIVE
// ─────────────────────────────────────────────────────────────────────────────
exports.backfillPointageBdpLiveTrigger = functions
  .region("europe-west1")
  .runWith({ secrets: ["ADMIN_SECRET"], timeoutSeconds: 540, memory: "512MB" })
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

    // GARDE-FOU 1 : confirmation live explicite (évite tout write live accidentel).
    const confirm = (req.query && req.query.confirm) || (req.body && req.body.confirm);
    if (confirm !== "LIVE") {
      return res.status(400).json({ success: false, error: "confirmation live requise (confirm=LIVE)" });
    }

    const from = (req.query && req.query.from) || (req.body && req.body.from);
    const to = (req.query && req.query.to) || (req.body && req.body.to);
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ success: false, error: "from/to (YYYY-MM-DD) requis" });
    }
    if (from > to) {
      return res.status(400).json({ success: false, error: "from doit être ≤ to" });
    }

    // GARDE-FOU 2 : borne de sécurité — plage ≤ 40 jours.
    const spanDays =
      Math.round((new Date(to + "T00:00:00.000Z") - new Date(from + "T00:00:00.000Z")) / 86400000) + 1;
    if (spanDays > 40) {
      return res.status(400).json({ success: false, error: `plage ${spanDays}j > 40 jours (borne de sécurité)` });
    }

    try {
      const result = await pointageBdpSync.syncPointageFromProd(db_firestore, { from, to, target: "live" });
      return res.status(result.success ? 200 : 500).json(result);
    } catch (err) {
      console.error("[backfillPointageBdpLiveTrigger] error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// validatePointageBdpTrigger — P2b : VALIDATION CROISÉE juin.
// Compare sql_mirror_pointage_bdp_test/{date} (reconstruit) vs
// sql_mirror_pointage/{date} (mirror BDR figé) LIGNE À LIGNE.
// Clé = (Personnel_Matricule × DateStr × Operation × Ref_parcelle).
// Nombre_Jr : égalité STRICTE ; Cout/cout_beeone_ref : tolérance ±1 MAD.
// Protégé par ADMIN_SECRET. AUCUNE écriture (comparateur read-only Firestore).
// Appel : GET /api/validate-pointage-bdp-test?secret=<ADMIN_SECRET>&date=YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────────────────
exports.validatePointageBdpTrigger = functions
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

    const date = req.query && req.query.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "date requise (YYYY-MM-DD)" });
    }

    try {
      const [temoinSnap, mirrorSnap] = await Promise.all([
        db_firestore.collection("sql_mirror_pointage_bdp_test").doc(date).get(),
        db_firestore.collection("sql_mirror_pointage").doc(date).get(),
      ]);
      const temoinRows = temoinSnap.exists ? (temoinSnap.data().rows || []) : [];
      const mirrorRows = mirrorSnap.exists ? (mirrorSnap.data().rows || []) : [];
      const report = comparePointageBdp(temoinRows, mirrorRows, { tolCout: 1 });
      return res.status(200).json({
        success: true,
        date,
        temoin_present: temoinSnap.exists,
        mirror_present: mirrorSnap.exists,
        ...report,
      });
    } catch (err) {
      console.error("[validatePointageBdpTrigger] error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// rh — Référentiel personnel RH depuis BEE ONE (BEE_BERRY_GOOD).
// Action : GET /api/rh?action=personnel-ref
//   Retourne { success: true, data: { [matricule]: { cin, cnss, nom, prenom } } }
// Auth Firebase requise. Accès restreint aux profils full-access (dg/finance/rh/admin).
// READ-ONLY : uniquement des SELECT sur la table Personnel de BEE ONE.
// ─────────────────────────────────────────────────────────────────────────────
