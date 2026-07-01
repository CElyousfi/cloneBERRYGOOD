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

/**
 * Résout le profil COMPLET du caller depuis Firestore (users/{uid}) :
 * { profileId, role, ferme }, à partir de l'utilisateur authentifié (token
 * Firebase) — JAMAIS depuis le body client. Utilisé pour resolvePerimetre, qui
 * a besoin du rôle système ('admin') et de la ferme de repli.
 *
 * Cas admin-cli (accès admin-secret sans doc users) : périmètre global dg/admin.
 *
 * @param {{uid?: string}|null|undefined} authUser
 * @returns {Promise<{profileId: (string|null), role: (string|null), ferme: (string|null)}>}
 */
async function resolveCallerProfile(authUser) {
  if (!authUser || !authUser.uid) return { profileId: null, role: null, ferme: null };
  if (authUser.uid === 'admin-cli') return { profileId: 'dg', role: 'admin', ferme: null };
  try {
    const snap = await db.collection('users').doc(authUser.uid).get();
    if (!snap.exists) return { profileId: null, role: null, ferme: null };
    const d = snap.data() || {};
    return {
      profileId: d.profileId || null,
      role: d.role || null,
      ferme: d.ferme || null,
    };
  } catch (e) {
    return { profileId: null, role: null, ferme: null };
  }
}

module.exports = { resolveCallerRole, resolveCallerProfile };
