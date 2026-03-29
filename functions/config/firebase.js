/**
 * firebase.js — Shared Firebase Admin SDK initialization.
 *
 * Ensures admin.initializeApp() is called exactly once,
 * then exports the shared Firestore and Storage references.
 */

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const bucket = admin.storage().bucket("berrygood-farms-photos");

module.exports = { admin, db, bucket };
