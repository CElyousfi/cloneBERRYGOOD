/**
 * cors.js — CORS headers helper for Cloud Function HTTP endpoints.
 */

const ALLOWED_ORIGINS = [
  "https://berrygood-farms-dashboard.web.app",
  "https://berrygood-farms-dashboard.firebaseapp.com",
  "http://localhost:8088",
  "http://localhost:5000",
];

function setCors(res, req) {
  const origin = req && req.headers && req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0]);
  }
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

module.exports = { setCors, handleCors };
