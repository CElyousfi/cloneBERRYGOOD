/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { admin, db_firestore, functions, setCors, verifyAuth } = require("../../shared/core");

exports.authApi = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB", minInstances: 1 })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
      const action = req.query.action || "me";

      if (action === "me") {
        const decoded = await verifyAuth(req);
        if (!decoded) return res.status(401).json({ success: false, error: "Non authentifié" });

        let userDoc = await db_firestore.collection("users").doc(decoded.uid).get();
        // If no doc by UID (e.g. first Google login), search by email and migrate
        if (!userDoc.exists && decoded.email) {
          const emailSnap = await db_firestore.collection("users")
            .where("email", "==", decoded.email).limit(1).get();
          if (!emailSnap.empty) {
            const oldDoc = emailSnap.docs[0];
            const oldData = oldDoc.data();
            // Create doc with correct UID and delete old placeholder
            await db_firestore.collection("users").doc(decoded.uid).set(oldData);
            if (oldDoc.id !== decoded.uid) await oldDoc.ref.delete();
            userDoc = await db_firestore.collection("users").doc(decoded.uid).get();
          }
        }
        if (!userDoc.exists) {
          return res.status(404).json({ success: false, error: "Utilisateur non configuré. Contactez l'administrateur." });
        }
        const data = userDoc.data();
        if (data.disabled) {
          return res.json({ success: false, error: "Compte désactivé", disabled: true });
        }

        // Log connection for non-admin users (direct connections only)
        if (data.role !== 'admin') {
          const now = Date.now();
          const lastLogged = data.lastLoggedAt || 0;
          if (now - lastLogged > 5 * 60 * 1000) {
            db_firestore.collection('connection_logs').add({
              uid: decoded.uid,
              email: decoded.email,
              profileId: data.profileId || '',
              displayName: data.displayName || '',
              role: data.role || 'user',
              timestampMs: now,
            }).catch(err => console.warn('Connection log error:', err));
            db_firestore.collection('users').doc(decoded.uid).update({ lastLoggedAt: now })
              .catch(err => console.warn('Update lastLoggedAt error:', err));
          }
        }

        return res.json({ success: true, user: { uid: decoded.uid, email: decoded.email, ...data } });
      }

      // ---- Admin actions ----
      const decoded = await verifyAuth(req);
      if (!decoded) return res.status(401).json({ success: false, error: "Non authentifié" });

      const callerDoc = await db_firestore.collection("users").doc(decoded.uid).get();
      if (!callerDoc.exists || callerDoc.data().role !== "admin") {
        return res.status(403).json({ success: false, error: "Accès réservé aux administrateurs" });
      }

      // LIST users
      if (action === "list") {
        const snap = await db_firestore.collection("users").get();
        const users = [];
        for (const doc of snap.docs) {
          const d = doc.data();
          let authUser = null;
          try { authUser = await admin.auth().getUser(doc.id); } catch (e) {}
          users.push({
            uid: doc.id,
            email: authUser ? authUser.email : d.email,
            displayName: d.displayName || "",
            profileId: d.profileId || "",
            role: d.role || "user",
            disabled: d.disabled || false,
            googleLinked: authUser ? authUser.providerData.some(p => p.providerId === "google.com") : false,
            lastSignIn: authUser ? authUser.metadata.lastSignInTime : null,
            createdAt: d.createdAt || null,
            whatsappPhone: d.whatsappPhone || "",
            whatsappEnabled: d.whatsappEnabled || false,
            ferme: d.ferme || "",
          });
        }
        return res.json({ success: true, users });
      }

      // CREATE user
      if (action === "create" && req.method === "POST") {
        const { email, password, displayName, profileId, role, whatsappPhone, ferme } = req.body;
        if (!email || !password || !profileId) {
          return res.status(400).json({ success: false, error: "Email, mot de passe et profil requis" });
        }
        const userRecord = await admin.auth().createUser({
          email, password, displayName: displayName || email,
        });
        const userData = {
          email, displayName: displayName || "", profileId,
          role: role || "user", disabled: false,
          createdAt: Date.now(), createdBy: decoded.uid, updatedAt: Date.now(),
          whatsappEnabled: !!whatsappPhone,
        };
        if (whatsappPhone) userData.whatsappPhone = whatsappPhone;
        if (ferme) userData.ferme = ferme;
        await db_firestore.collection("users").doc(userRecord.uid).set(userData);
        return res.json({ success: true, uid: userRecord.uid });
      }

      // UPDATE user
      if (action === "update" && req.method === "POST") {
        const { uid, displayName, profileId, role, disabled, password, whatsappPhone, whatsappEnabled, ferme } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: "UID requis" });

        const updates = { updatedAt: Date.now() };
        const authUpdates = {};

        if (displayName !== undefined) { updates.displayName = displayName; authUpdates.displayName = displayName; }
        if (profileId !== undefined) updates.profileId = profileId;
        if (role !== undefined) updates.role = role;
        if (disabled !== undefined) updates.disabled = disabled;
        if (password) authUpdates.password = password;
        if (whatsappPhone !== undefined) updates.whatsappPhone = whatsappPhone;
        if (whatsappEnabled !== undefined) updates.whatsappEnabled = whatsappEnabled;
        if (ferme !== undefined) updates.ferme = ferme;

        if (Object.keys(authUpdates).length > 0) {
          try {
            await admin.auth().updateUser(uid, authUpdates);
          } catch (authErr) {
            // User doesn't exist in Auth — recreate if password provided
            if (authErr.code === 'auth/user-not-found') {
              const userDoc = await db_firestore.collection("users").doc(uid).get();
              const email = userDoc.exists ? userDoc.data().email : null;
              if (email && password) {
                await admin.auth().createUser({ uid, email, password, displayName: displayName || '', disabled: !!disabled });
              } else {
                return res.status(404).json({ success: false, error: "Utilisateur introuvable dans Auth. Fournissez un nouveau mot de passe pour le recréer." });
              }
            } else {
              throw authErr;
            }
          }
        }
        await db_firestore.collection("users").doc(uid).set(updates, { merge: true });
        return res.json({ success: true });
      }

      // DELETE user
      if (action === "delete" && req.method === "POST") {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: "UID requis" });
        if (uid === decoded.uid) return res.status(400).json({ success: false, error: "Impossible de supprimer votre propre compte" });
        try { await admin.auth().deleteUser(uid); } catch (e) {}
        await db_firestore.collection("users").doc(uid).delete();
        return res.json({ success: true });
      }

      // TOGGLE Google Auth
      if (action === "toggle-google" && req.method === "POST") {
        // This is handled client-side via Firebase Auth. Just a placeholder.
        return res.json({ success: true, message: "Google auth is configured client-side" });
      }

      // CONNECTION STATS — for DG adoption tracking
      if (action === "connection-stats") {
        const days = parseInt(req.query.days) || 90;
        const since = Date.now() - (days * 24 * 60 * 60 * 1000);

        const snap = await db_firestore.collection('connection_logs')
          .where('timestampMs', '>=', since)
          .orderBy('timestampMs', 'desc')
          .get();

        const logs = snap.docs.map(doc => {
          const d = doc.data();
          return { uid: d.uid, email: d.email, profileId: d.profileId, displayName: d.displayName, role: d.role, timestampMs: d.timestampMs };
        });

        const usersSnap = await db_firestore.collection('users').get();
        const allUsers = usersSnap.docs
          .map(d => ({ uid: d.id, email: d.data().email, displayName: d.data().displayName || '', profileId: d.data().profileId || '', role: d.data().role || 'user', disabled: d.data().disabled || false }))
          .filter(u => u.role !== 'admin' && !u.disabled);

        return res.json({ success: true, logs, allUsers });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur Auth API:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// Hors Récolte Suivi — Saisie caporal + progression
// =============================================
