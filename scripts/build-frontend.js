#!/usr/bin/env node
// Reliable frontend build: babel jsx → js, verify sentinel, cache-bust index.html.
// Run via `npm run build:frontend`. Exits non-zero on any failure so Firebase
// predeploy aborts instead of shipping a stale bundle.

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "public/app.jsx");
const OUT = path.join(ROOT, "public/app.js");
const HTML = path.join(ROOT, "public/index.html");

// 1. Babel
const babel = spawnSync(
  "npx",
  ["babel", SRC, "--presets", "@babel/preset-react", "-o", OUT],
  { stdio: "inherit", cwd: ROOT }
);
if (babel.status !== 0) {
  console.error("[build-frontend] babel failed with status", babel.status);
  process.exit(1);
}

// 2. Sentinel check — if the build is truncated or silently skipped, app.js will
// not contain this identifier. Update the list as new screens are added.
const SENTINELS = ["AgroAnalyseFoliairesTab", "generateIA", "CaisseTab", "BdcWorkflow.requiresChefValidation"];
const built = fs.readFileSync(OUT, "utf8");
for (const s of SENTINELS) {
  if (!built.includes(s)) {
    console.error(`[build-frontend] sentinel missing in app.js: ${s}`);
    process.exit(2);
  }
}

// 2bis. Sibling lib check — bdcWorkflow.js is loaded as a separate <script>,
// so verify the file exists and contains the canonical farm list.
const BDC_WORKFLOW = path.join(ROOT, "public/lib/bdcWorkflow.js");
if (!fs.existsSync(BDC_WORKFLOW)) {
  console.error("[build-frontend] missing public/lib/bdcWorkflow.js");
  process.exit(2);
}
if (!fs.readFileSync(BDC_WORKFLOW, "utf8").includes("DIRECT_DG_FARMS")) {
  console.error("[build-frontend] sentinel missing in public/lib/bdcWorkflow.js: DIRECT_DG_FARMS");
  process.exit(2);
}

// 3. Cache-bust: rewrite <script src="app.js?v=..."> AND <script src="lib/*.js?v=...">
const version = Date.now().toString(36);
const html = fs.readFileSync(HTML, "utf8");
let updated = html.replace(/(<script[^>]+src=["']app\.js)(\?v=[^"']*)?(["'])/g, `$1?v=${version}$3`);
updated = updated.replace(/(<script[^>]+src=["']lib\/[A-Za-z0-9_.\-]+\.js)(\?v=[^"']*)?(["'])/g, `$1?v=${version}$3`);
if (updated === html) {
  console.error("[build-frontend] could not find <script src=\"app.js\"> in index.html");
  process.exit(3);
}
fs.writeFileSync(HTML, updated);

const bytes = fs.statSync(OUT).size;
console.log(`[build-frontend] ok — app.js ${bytes.toLocaleString()} bytes, version ${version}`);
