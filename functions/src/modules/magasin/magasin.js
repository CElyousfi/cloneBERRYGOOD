/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { admin, db_firestore, functions, requireAuth, setCors, whatsappService } = require("../../shared/core");

const { createStockFileReminders } = require("../../../lib/stockFiles/reminders");
const stockFileReminders = createStockFileReminders({
  db: db_firestore,
  whatsapp: whatsappService,
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
});

exports.stockFileReminder16h = functions.region("europe-west1").pubsub
  .schedule("0 16 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(() => stockFileReminders.sendReminder("16h"));

exports.stockFileReminder17h = functions.region("europe-west1").pubsub
  .schedule("0 17 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(() => stockFileReminders.sendReminder("17h"));

exports.stockFileReminder18h = functions.region("europe-west1").pubsub
  .schedule("0 18 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(() => stockFileReminders.sendReminder("18h", { escalateToDg: true }));

// Manual trigger for prod sync — ?action=recolte&since=2025-07-01 for historical
const MC_PARCELLES_CONSO = "parcelles_consommation";
const MC_MAPPING_CAMPAGNE = "mapping_campagne";
const MC_PARCELLES_CHARGE = "parcelles_culturales_charge";

exports.mappingConsoManagement = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "POST uniquement" });
    }
    try {
      const action = req.query.action;
      const body = req.body || {};
      const valide_par = { uid: authUser.uid, name: authUser.name || authUser.email || "" };
      const now = admin.firestore.FieldValue.serverTimestamp();

      // ---- POST seed-campagne : idempotent (set merge) depuis le seed module ----
      if (action === "seed-campagne") {
        const { SEED_2025_2026 } = require("../../../lib/mappingConso/seed");
        const campagne = body.campagne || SEED_2025_2026.campagne;
        if (campagne !== SEED_2025_2026.campagne) {
          return res.status(400).json({ success: false, error: "Campagne non disponible au seed: " + campagne });
        }
        let batch = db_firestore.batch();
        let ops = 0;
        const flush = async () => { if (ops > 0) { await batch.commit(); batch = db_firestore.batch(); ops = 0; } };

        for (const p of SEED_2025_2026.parcellesConsommation) {
          batch.set(db_firestore.collection(MC_PARCELLES_CONSO).doc(p.id), {
            id: p.id,
            libelle: p.libelle,
            ferme: p.ferme,
            secteur: p.secteur,
            variete: p.variete,
            stade: p.stade,
            famille: p.famille,
          }, { merge: true });
          if (++ops >= 400) await flush();
        }
        for (const m of SEED_2025_2026.mappingCampagne) {
          batch.set(db_firestore.collection(MC_MAPPING_CAMPAGNE).doc(m.docId), {
            campagne: m.campagne,
            parcelle_conso_id: m.parcelle_conso_id,
            cible_parcelle_culturale: m.cible_parcelle_culturale,
            // RÉALIGNEMENT PARCELLE_TO_CPC : répartition 1:N (mutuellement
            // exclusive avec cible_parcelle_culturale). null si cible unique.
            repartition: m.repartition != null ? m.repartition : null,
            statut: m.statut,
            confiance: m.confiance,
            note: m.note,
          }, { merge: true });
          if (++ops >= 400) await flush();
        }
        await flush();
        return res.json({
          success: true,
          campagne,
          parcelles: SEED_2025_2026.parcellesConsommation.length,
          mappings: SEED_2025_2026.mappingCampagne.length,
        });
      }

      // ---- Actions sur un doc mapping_campagne : docId requis ----
      const docId = body.docId;
      if (!docId || !String(docId).trim()) {
        return res.status(400).json({ success: false, error: "docId requis" });
      }
      const mappingRef = db_firestore.collection(MC_MAPPING_CAMPAGNE).doc(String(docId));

      // ---- validate-alias : alias_propose → alias_valide ----
      if (action === "validate-alias") {
        await mappingRef.update({ statut: "alias_valide", valide_par, valide_le: now });
        return res.json({ success: true });
      }

      // ---- confirm-perimetre : hors_propose → hors_confirme ----
      if (action === "confirm-perimetre") {
        await mappingRef.update({ statut: "hors_confirme", valide_par, valide_le: now });
        return res.json({ success: true });
      }

      // ---- reassign : maj cible_parcelle_culturale OU repartition 1:N ----
      // RÉALIGNEMENT PARCELLE_TO_CPC : cible unique et répartition sont
      // MUTUELLEMENT EXCLUSIVES. Si repartition fournie → Σpct doit valoir 100.
      if (action === "reassign") {
        const hasCible = typeof body.cible_parcelle_culturale === "string";
        const hasRep = Array.isArray(body.repartition);
        if (hasCible && hasRep) {
          return res.status(400).json({ success: false, error: "cible_parcelle_culturale et repartition sont mutuellement exclusifs" });
        }
        if (!hasCible && !hasRep) {
          return res.status(400).json({ success: false, error: "cible_parcelle_culturale ou repartition requise" });
        }
        if (hasRep) {
          let sum = 0;
          for (const part of body.repartition) {
            if (!part || typeof part.cible !== "string" || typeof part.pct !== "number") {
              return res.status(400).json({ success: false, error: "repartition: chaque entrée doit être { cible:string, pct:number }" });
            }
            sum += part.pct;
          }
          if (sum !== 100) {
            return res.status(400).json({ success: false, error: "repartition: Σpct doit valoir 100 (reçu " + sum + ")" });
          }
          await mappingRef.update({ cible_parcelle_culturale: null, repartition: body.repartition, valide_par, valide_le: now });
          return res.json({ success: true });
        }
        await mappingRef.update({ cible_parcelle_culturale: body.cible_parcelle_culturale, repartition: null, valide_par, valide_le: now });
        return res.json({ success: true });
      }

      // ---- create-parcelle : crée parcelles_culturales_charge PUIS update mapping ----
      if (action === "create-parcelle") {
        const result = await db_firestore.runTransaction(async (tx) => {
          const mapSnap = await tx.get(mappingRef);
          if (!mapSnap.exists) throw new Error("Mapping introuvable: " + docId);
          const map = mapSnap.data() || {};
          const consoRef = db_firestore.collection(MC_PARCELLES_CONSO).doc(String(map.parcelle_conso_id || ""));
          const consoSnap = map.parcelle_conso_id ? await tx.get(consoRef) : null;
          const conso = (consoSnap && consoSnap.exists) ? consoSnap.data() : {};
          const libelle = conso.libelle || map.parcelle_conso_id || String(docId);

          const chargeRef = db_firestore.collection(MC_PARCELLES_CHARGE).doc();
          tx.set(chargeRef, {
            libelle: libelle,
            ferme: conso.ferme != null ? conso.ferme : null,
            secteur: conso.secteur != null ? conso.secteur : null,
            variete: conso.variete != null ? conso.variete : null,
            stade: conso.stade != null ? conso.stade : null,
            cree_par: valide_par,
            cree_le: now,
            origine: "mapping_conso",
          });
          tx.update(mappingRef, {
            statut: "creee",
            cible_parcelle_culturale: libelle,
            valide_par,
            valide_le: now,
          });
          return { charge_id: chargeRef.id, libelle };
        });
        return res.json({ success: true, charge_id: result.charge_id, libelle: result.libelle });
      }

      // ---- revert : remet le statut antérieur (pas de valide_par) ----
      if (action === "revert") {
        const REVERT = { alias_valide: "alias_propose", creee: "a_creer", hors_confirme: "hors_propose" };
        const back = REVERT[body.statut];
        if (!back) {
          return res.status(400).json({ success: false, error: "Statut non réversible: " + body.statut });
        }
        await mappingRef.update({ statut: back });
        return res.json({ success: true, statut: back });
      }

      return res.status(400).json({ success: false, error: "Action inconnue ou méthode invalide" });
    } catch (err) {
      console.error("Erreur mappingConsoManagement:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Upload photo parcelle — Firebase Storage
// =============================================
