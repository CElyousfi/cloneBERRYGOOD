/* magasin.stock.js — point d'entree HTTP du domaine stock.

   Les 118 actions de stockManagement vivent dans magasin.stock.actions*.js.
   Elles sont essayees DANS L'ORDRE D'ORIGINE : la premiere qui traite l'action
   rend la main, exactement comme la chaine de `if` du monolithe. */
'use strict';
const { NOT_HANDLED } = require("./_dispatch");
const { admin, db_firestore, functions, requireAuth, stockMovementGuard, identiteArticle, getIdentiteArticleIndex, resoudreLignesStock } = require("./magasin.stock.deps");
const __actions = [
  require("./magasin.stock.actions1"),
  require("./magasin.stock.actions2"),
  require("./magasin.stock.actions3"),
  require("./magasin.stock.actions4"),
  require("./magasin.stock.actions5"),
  require("./magasin.stock.actions6"),
];

exports.stockManagement = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB", secrets: ["ADMIN_SECRET"] })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).send("");

    const action = req.query.action || req.body?.action || "stock-dashboard";

    // Admin-only actions (no Firebase Auth, uses env secret)
    const adminSecret = process.env.ADMIN_SECRET;
    if (action === "reset-email-cursor" && req.method === "POST") {
      if (req.body.secret !== adminSecret) return res.status(403).json({ success: false, error: "forbidden" });
      const { uid } = req.body;
      if (typeof uid !== "number") return res.status(400).json({ success: false, error: "uid (number) requis" });
      await db_firestore.collection("config").doc("email_fetch").set({ lastPollUid: uid }, { merge: true });
      return res.json({ success: true, message: `lastPollUid reset to ${uid}` });
    }
    if (action === "reprocess-email" && req.method === "POST") {
      if (req.body.secret !== adminSecret) return res.status(403).json({ success: false, error: "forbidden" });
      const { uid } = req.body;
      if (!uid) return res.status(400).json({ success: false, error: "uid requis" });
      // Find the email doc by scanning for matching uid
      const snap = await db_firestore.collection("emails").where("uid", "==", uid).limit(1).get();
      if (snap.empty) return res.json({ success: false, error: `No email doc found with uid=${uid}` });
      const docRef = snap.docs[0].ref;
      const docId = snap.docs[0].id;
      const data = snap.docs[0].data();
      // Delete and re-create to trigger analyzeEmail (onCreate)
      await docRef.delete();
      await db_firestore.collection("emails").doc(docId).set({ ...data, status: "pending", reprocessed_at: Date.now() });
      return res.json({ success: true, message: `Email doc ${docId} (uid=${uid}) deleted and re-created with status=pending` });
    }

    // Skip Firebase Auth when admin secret is provided (CLI/scripts)
    let authUser;
    if (req.body?.secret === adminSecret) {
      authUser = { uid: "admin-cli", email: "admin@berrygood.ma" };
    } else {
      authUser = await requireAuth(req, res);
      if (!authUser) return;
    }

    try {


      // ========== STOCK MOVEMENTS (Gestion de stock) ==========

      // --- Helper: update stock_balances atomically ---
      //
      // ⚠️ `ficheId` DOIT être une identité DÉJÀ RÉSOLUE (docId d'une fiche
      // active du catalogue), jamais un libellé. C'est la règle que ce lot
      // installe : l'identifiant du document de solde est
      // `${lieu_type}_${lieu_id}_${docId de fiche}`. Passer un libellé ici
      // recrée exactement le défaut d'origine — deux documents de solde pour le
      // même article au même lieu, 47 cas mesurés le 2026-08-31.
      // La résolution se fait chez l'appelant (`resoudreLignesStock`), qui peut
      // REFUSER le bon ; ce helper, lui, ne sait pas refuser : il écrit.
      async function updateStockBalance(lieuType, lieuId, ficheId, articleNom, unite, delta) {
        const balanceId = identiteArticle.identifiantSoldeCanonique(lieuType, lieuId, ficheId);
        const balRef = db_firestore.collection("stock_balances").doc(balanceId);
        await db_firestore.runTransaction(async (t) => {
          const snap = await t.get(balRef);
          const current = snap.exists ? (snap.data().balance || 0) : 0;
          const newBalance = Math.round((current + delta) * 100) / 100;
          t.set(balRef, {
            lieu_type: lieuType, lieu_id: lieuId,
            // `article_ref` porte l'IDENTITÉ (docId de fiche) ; `article_nom`
            // garde le libellé saisi, qui reste ce que le magasinier lit.
            article_ref: ficheId, article_nom: articleNom,
            unite: unite || "kg", balance: newBalance,
            updated_at: Date.now()
          }, { merge: true });
        });
      }


      // --- Helper: apply stock impact for a validated movement ---
      //
      // Le repli `item.article_ref || item.article` A DISPARU : il prenait un
      // LIBELLÉ pour une identité, et c'est lui qui rangeait le solde dans un
      // second document à côté de celui de la fiche. La règle est désormais
      // `identiteArticle.identiteImpact`, module PUR et testé.
      //
      // ⚠️ CE QUE CETTE SYMÉTRIE GARANTIT — ET CE QU'ELLE NE GARANTIT PAS.
      // `apply` et `reverse` partagent la MÊME fonction : pour un mouvement
      // donné, ils calculent forcément la même clé. Mais cela ne vaut que si
      // les deux passent par ce code. Ce n'est PAS le cas des 4 355 mouvements
      // ANTÉRIEURS à ce lot : leur aller a débité la clé BRUTE (le libellé),
      // et leur annulation, elle, visera la clé RÉSOLUE. Le retour tombe donc
      // dans un autre document que l'aller (vérifié sur BCG-5620).
      // Ce n'est pas une perte — la SOMME des deux fragments reste juste, et la
      // re-clé des soldes prévue au déploiement les réunit. Mais tant que cette
      // re-clé n'a pas eu lieu, ne pas lire ce helper comme « l'annulation vise
      // exactement le document que l'application a touché » : c'est vrai des
      // mouvements créés APRÈS ce lot, faux des précédents.
      async function applyStockImpact(movement) {
        const promises = [];
        const identiteIndex = await getIdentiteArticleIndex(db_firestore);
        for (const item of (movement.items || [])) {
          const ref = identiteArticle.identiteImpact(item, identiteIndex);
          const nom = item.article_nom || item.article || "";
          const qty = parseFloat(item.quantite) || 0;
          const unite = item.unite || "kg";
          if (qty <= 0) continue;
          // Decrease source
          if (movement.lieu_source && movement.lieu_source.id) {
            promises.push(updateStockBalance(movement.lieu_source.type, movement.lieu_source.id, ref, nom, unite, -qty));
          }
          // Increase destination (not for parcelles or external)
          if (movement.lieu_destination && movement.lieu_destination.id && movement.lieu_destination.type !== "parcelle") {
            promises.push(updateStockBalance(movement.lieu_destination.type, movement.lieu_destination.id, ref, nom, unite, qty));
          }
        }
        await Promise.all(promises);
      }


      // --- Helper: annule l'impact stock d'un mouvement validé (delta inverse) ---
      // Applique l'opposé exact de applyStockImpact : re-crédite la source et
      // re-débite la destination. À n'appeler QUE si le mouvement avait un impact
      // matérialisé (status === valide_chef), sinon double-comptage.
      async function reverseStockImpact(movement) {
        const promises = [];
        // MÊME résolution que applyStockImpact, par la MÊME fonction pure —
        // avec la réserve documentée là-bas sur les mouvements antérieurs au
        // lot, dont l'aller avait débité la clé brute.
        const identiteIndex = await getIdentiteArticleIndex(db_firestore);
        for (const item of (movement.items || [])) {
          const ref = identiteArticle.identiteImpact(item, identiteIndex);
          const nom = item.article_nom || item.article || "";
          const qty = parseFloat(item.quantite) || 0;
          const unite = item.unite || "kg";
          if (qty <= 0) continue;
          // Inverse de la source : on re-crédite (+qty au lieu de -qty)
          if (movement.lieu_source && movement.lieu_source.id) {
            promises.push(updateStockBalance(movement.lieu_source.type, movement.lieu_source.id, ref, nom, unite, qty));
          }
          // Inverse de la destination : on re-débite (-qty au lieu de +qty)
          if (movement.lieu_destination && movement.lieu_destination.id && movement.lieu_destination.type !== "parcelle") {
            promises.push(updateStockBalance(movement.lieu_destination.type, movement.lieu_destination.id, ref, nom, unite, -qty));
          }
        }
        await Promise.all(promises);
      }


      // --- Helper: determine chef profile for a ferme ---
      function getChefProfileForFerme(ferme) {
        if (ferme === "F1") return "chef_f1";
        if (ferme === "F5") return "chef_f5";
        if (["F2", "F3", "F4", "F6"].includes(ferme)) return "chef_avo";
        return null;
      }


      // --- Helper: résout l'identité du demandeur depuis le TOKEN (jamais le body) ---
      // Renvoie { profileId, userId } : userId = uid Firebase, profileId tiré de
      // users/{uid}. Le contrôle créateur s'appuie dessus (cf. stockMovementGuard).
      async function resolveRequesterIdentity(au) {
        const uid = (au && au.uid) || "";
        let profileId = "";
        if (uid && uid !== "admin-cli") {
          try {
            const uDoc = await db_firestore.collection("users").doc(uid).get();
            if (uDoc.exists) profileId = uDoc.data().profileId || "";
          } catch (_) { /* ignore */ }
        }
        return { userId: uid, profileId, isAdminCli: uid === "admin-cli" };
      }


      return res.status(400).json({ success: false, error: "Action inconnue: " + action });

      const __ctx = { req, res, action, adminSecret, authUser, updateStockBalance, applyStockImpact, reverseStockImpact, getChefProfileForFerme, resolveRequesterIdentity };
      for (const __handle of __actions) {
        const __r = await __handle(__ctx);
        if (__r !== NOT_HANDLED) return __r;
      }


    
} catch (err) {
      console.error("Erreur Stock Management:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
