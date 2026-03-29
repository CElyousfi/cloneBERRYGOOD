/**
 * requireAuth.js — Firebase Auth verification middleware for Cloud Functions.
 *
 * Usage:
 *   const { verifyAuth, requireAuth } = require("./middleware/requireAuth");
 *
 *   // Option 1: manual check
 *   const decoded = await verifyAuth(req);
 *   if (!decoded) return res.status(401).json({ error: "Non authentifié" });
 *
 *   // Option 2: middleware-style (returns decoded token or sends 401)
 *   const decoded = await requireAuth(req, res);
 *   if (!decoded) return; // response already sent
 */

const { admin } = require("../config/firebase");

async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    return await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
  } catch (e) {
    return null;
  }
}

async function requireAuth(req, res) {
  const decoded = await verifyAuth(req);
  if (!decoded) {
    res.status(401).json({ success: false, error: "Non authentifié" });
    return null;
  }
  return decoded;
}

module.exports = { verifyAuth, requireAuth };
