/**
 * cors.js — CORS headers helper for Cloud Function HTTP endpoints.
 *
 * Origins allowed:
 * - Prod Firebase Hosting (web.app / firebaseapp.com).
 * - Preview channels (`firebase hosting:channel:deploy <name>`), which get
 *   URLs shaped like
 *   `https://berrygood-farms-dashboard--<channel>-<hash>.web.app`.
 * - Localhost (dev), kept as an exact list — no need to widen the regex for it.
 */

const ALLOWED_ORIGIN_PATTERN = /^https:\/\/berrygood-farms-dashboard(--[a-z0-9-]+)?\.(web\.app|firebaseapp\.com)$/;
const ALLOWED_LOCAL_ORIGINS = ["http://localhost:8088", "http://localhost:5000"];
const DEFAULT_ORIGIN = "https://berrygood-farms-dashboard.web.app";

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERN.test(origin) || ALLOWED_LOCAL_ORIGINS.includes(origin);
}

function setCors(res, req) {
  const origin = req && req.headers && req.headers.origin;
  res.set("Access-Control-Allow-Origin", isAllowedOrigin(origin) ? origin : DEFAULT_ORIGIN);
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function handleCors(req, res) {
  setCors(res, req);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

module.exports = { setCors, handleCors, isAllowedOrigin };
