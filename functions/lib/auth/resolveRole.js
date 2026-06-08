'use strict';

const { db } = require('../../config/firebase');

/**
 * Résout le profileId/rôle RÉEL du caller depuis Firestore (users/{uid}),
 * à partir de l'utilisateur authentifié (token Firebase) — JAMAIS depuis le body client.
 * @param {{uid?: string}|null|undefined} authUser
 * @returns {Promise<string|null>}
 */
async function resolveCallerRole(authUser) {
  if (!authUser || !authUser.uid) return null;
  try {
    const snap = await db.collection('users').doc(authUser.uid).get();
    return snap.exists ? (snap.data().profileId || null) : null;
  } catch (e) {
    return null;
  }
}

module.exports = { resolveCallerRole };
