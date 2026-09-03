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
const SENTINELS = ["AgroAnalyseFoliairesTab", "generateIA", "CaisseTab", "BdcWorkflow.requiresChefValidation", "StockMovementGuard"];
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

// 2ter. Sibling lib check — stockMovementGuard.js (édition/suppression de bons stock).
const STOCK_GUARD = path.join(ROOT, "public/lib/stockMovementGuard.js");
if (!fs.existsSync(STOCK_GUARD)) {
  console.error("[build-frontend] missing public/lib/stockMovementGuard.js");
  process.exit(2);
}
if (!fs.readFileSync(STOCK_GUARD, "utf8").includes("canEditMovement")) {
  console.error("[build-frontend] sentinel missing in public/lib/stockMovementGuard.js: canEditMovement");
  process.exit(2);
}

// 2ter-bis. Sibling lib check — analytiqueUtils.js (pivot Affectation Analytique, Quinzaine).
const ANALYTIQUE_UTILS = path.join(ROOT, "public/lib/analytiqueUtils.js");
if (!fs.existsSync(ANALYTIQUE_UTILS)) {
  console.error("[build-frontend] missing public/lib/analytiqueUtils.js");
  process.exit(2);
}
if (!fs.readFileSync(ANALYTIQUE_UTILS, "utf8").includes("buildAnalytiquePivot")) {
  console.error("[build-frontend] sentinel missing in public/lib/analytiqueUtils.js: buildAnalytiquePivot");
  process.exit(2);
}

// 2ter-ter. Sibling lib check — cultureUtils.js (résolution de la culture d'une parcelle).
const CULTURE_UTILS = path.join(ROOT, "public/lib/cultureUtils.js");
if (!fs.existsSync(CULTURE_UTILS)) {
  console.error("[build-frontend] missing public/lib/cultureUtils.js");
  process.exit(2);
}
if (!fs.readFileSync(CULTURE_UTILS, "utf8").includes("resolveCulture")) {
  console.error("[build-frontend] sentinel missing in public/lib/cultureUtils.js: resolveCulture");
  process.exit(2);
}

// 2ter-quater. Sibling lib check — campagneExportUtils.js (export Excel Campagne).
const CAMPAGNE_EXPORT_UTILS = path.join(ROOT, "public/lib/campagneExportUtils.js");
if (!fs.existsSync(CAMPAGNE_EXPORT_UTILS)) {
  console.error("[build-frontend] missing public/lib/campagneExportUtils.js");
  process.exit(2);
}
if (!fs.readFileSync(CAMPAGNE_EXPORT_UTILS, "utf8").includes("buildParcelleSheetAoA")) {
  console.error("[build-frontend] sentinel missing in public/lib/campagneExportUtils.js: buildParcelleSheetAoA");
  process.exit(2);
}

// 2ter-quinquies. Sibling lib check — campagneBudgetPivot.js (budget/écart superposés
// sur la grille du pivot analytique, écran Campagne).
const CAMPAGNE_BUDGET_PIVOT = path.join(ROOT, "public/lib/campagneBudgetPivot.js");
if (!fs.existsSync(CAMPAGNE_BUDGET_PIVOT)) {
  console.error("[build-frontend] missing public/lib/campagneBudgetPivot.js");
  process.exit(2);
}
if (!fs.readFileSync(CAMPAGNE_BUDGET_PIVOT, "utf8").includes("buildBudgetPivot")) {
  console.error("[build-frontend] sentinel missing in public/lib/campagneBudgetPivot.js: buildBudgetPivot");
  process.exit(2);
}

// 2ter-sexies. Sibling lib check — campagneRythme.js (les deux restes de la
// grille Campagne : budgété et au rythme).
const CAMPAGNE_RYTHME = path.join(ROOT, "public/lib/campagneRythme.js");
if (!fs.existsSync(CAMPAGNE_RYTHME)) {
  console.error("[build-frontend] missing public/lib/campagneRythme.js");
  process.exit(2);
}
if (!fs.readFileSync(CAMPAGNE_RYTHME, "utf8").includes("decoreRestes")) {
  console.error("[build-frontend] sentinel missing in public/lib/campagneRythme.js: decoreRestes");
  process.exit(2);
}

// 2ter-septies. Sibling lib check — campagneBudgetQuinzaine.js (budget de la
// quinzaine en cours : engagement court terme et sa consommation).
const CAMPAGNE_BUDGET_QUINZAINE = path.join(ROOT, "public/lib/campagneBudgetQuinzaine.js");
if (!fs.existsSync(CAMPAGNE_BUDGET_QUINZAINE)) {
  console.error("[build-frontend] missing public/lib/campagneBudgetQuinzaine.js");
  process.exit(2);
}
if (!fs.readFileSync(CAMPAGNE_BUDGET_QUINZAINE, "utf8").includes("decoreQuinzaine")) {
  console.error("[build-frontend] sentinel missing in public/lib/campagneBudgetQuinzaine.js: decoreQuinzaine");
  process.exit(2);
}

// 2quater. Components — babelise chaque public/components/*.jsx → *.js (preset-react),
// puis vérifie une sentinelle par composant connu. Ces fichiers sont chargés en
// <script> séparés et partagent le scope global (IIFE → un seul global unique).
const COMPONENTS_DIR = path.join(ROOT, "public/components");
// Sentinelles attendues dans la sortie .js de chaque composant (identifiant du global exposé).
const COMPONENT_SENTINELS = {
  "BugReportButton.js": "window.BugReportButton",
  "BugReportsAdmin.js": "window.BugReportsAdmin",
  "PointageValidationPanel.js": "window.PointageValidationPanel",
  "PointageValidationView.js": "window.PointageValidationView",
  "MagMappingConsoTab.js": "window.MagMappingConsoTab",
  "MagBonsCommandeTab.js": "window.MagBonsCommandeTab",
  "MagBdcReceptionTab.js": "window.MagBdcReceptionTab",
  "MagBCTab.js": "window.MagBCTab",
  "ArticleConversionFields.js": "window.ArticleConversionFields",
  "ParcellesParamsTab.js": "window.ParcellesParamsTab",
  "ParcellesGroupesPanel.js": "window.ParcellesGroupesPanel",
  "PmpDetailPopup.js": "window.PmpDetailPopup",
  "InventaireMouvementsPopup.js": "window.InventaireMouvementsPopup",
  "FactureDetailPopup.js": "window.FactureDetailPopup",
  "ScanAttachmentButton.js": "window.ScanAttachmentButton",
  "ConsoValoriseeTab.js": "window.ConsoValoriseeTab",
  "QuinzaineCampagneSelect.js": "window.QuinzaineCampagneSelect",
  "PivotAnalytiqueGrid.js": "window.PivotAnalytiqueGrid",
  "AffectationAnalytiqueTable.js": "window.AffectationAnalytiqueTable",
  "QuinzaineRecapCards.js": "window.QuinzaineRecapCards",
  "CampagneAnalytiqueTab.js": "window.CampagneAnalytiqueTab",
  "CampagneBudgetTab.js": "window.CampagneBudgetTab",
  "MagStockFilesTab.js": "window.MagStockFilesTab",
  "HsEmargementFooter.js": "window.HsEmargementFooter",
};
if (fs.existsSync(COMPONENTS_DIR)) {
  const jsxFiles = fs.readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith(".jsx"));
  for (const jsx of jsxFiles) {
    const src = path.join(COMPONENTS_DIR, jsx);
    const out = path.join(COMPONENTS_DIR, jsx.replace(/\.jsx$/, ".js"));
    const res = spawnSync(
      "npx",
      ["babel", src, "--presets", "@babel/preset-react", "-o", out],
      { stdio: "inherit", cwd: ROOT }
    );
    if (res.status !== 0) {
      console.error(`[build-frontend] babel failed for component ${jsx} with status`, res.status);
      process.exit(1);
    }
    const sentinel = COMPONENT_SENTINELS[path.basename(out)];
    if (sentinel) {
      const builtComp = fs.readFileSync(out, "utf8");
      if (!builtComp.includes(sentinel)) {
        console.error(`[build-frontend] sentinel missing in ${path.basename(out)}: ${sentinel}`);
        process.exit(2);
      }
    }
  }
}

// 2quinquies. Chaque composant DOIT être référencé par un <script> dans
// index.html. Sans cette garde, un composant peut être construit, committé et
// déployé sans jamais être chargé par la page : le fichier répond en 200, mais
// `window.X` reste undefined et la fonctionnalité est muette, sans la moindre
// erreur. Cas réel du 2026-08-26 : la balise de CaisseDetailPopup a été perdue
// en résolvant un conflit de rebase sur index.html, et rien ne l'a signalé.
{
  const indexHtmlPath = path.join(ROOT, "public/index.html");
  const indexHtmlSrc = fs.readFileSync(indexHtmlPath, "utf8");
  const jsxFiles = fs.existsSync(COMPONENTS_DIR)
    ? fs.readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith(".jsx")).sort()
    : [];
  const orphelins = jsxFiles
    .map((f) => f.replace(/\.jsx$/, ".js"))
    .filter((js) => indexHtmlSrc.indexOf("components/" + js) === -1);
  if (orphelins.length > 0) {
    console.error(
      "[build-frontend] composant(s) construits mais JAMAIS chargés par public/index.html : " + orphelins.join(", ") + "\n" +
      "  Ajoute la balise correspondante dans public/index.html :\n" +
      orphelins.map((js) => '    <script defer src="components/' + js + '"></script>').join("\n")
    );
    process.exit(2);
  }
}

// 3. Cache-bust: rewrite <script src="lib/*.js?v=..."> AND
//    <script src="components/*.js?v=...">
//
// L'entrée (app.js ou app.modular.js) n'a plus de balise statique : elle est
// écrite au chargement par le sélecteur en bas de index.html, qui reprend le
// `?v=` de la balise lib/featureFlags.js. Une seule source de version dans la
// page — mais du coup cette balise porte le cache-bust de TOUTE l'entrée, et sa
// disparition invaliderait silencieusement le cache-busting du frontend. D'où
// la sentinelle ci-dessous, dans l'esprit des autres gardes de ce script.
const version = Date.now().toString(36);
const html = fs.readFileSync(HTML, "utf8");

const FLAGS_TAG_RE = /<script[^>]+src=["']lib\/featureFlags\.js(\?v=[^"']*)?["']/;
if (!FLAGS_TAG_RE.test(html)) {
  console.error(
    "[build-frontend] balise <script src=\"lib/featureFlags.js\"> absente de public/index.html.\n" +
    "  Le sélecteur d'entrée en bas de page en dérive le ?v= : sans elle, app.js\n" +
    "  et app.modular.js seraient servis sans cache-bust."
  );
  process.exit(3);
}
if (!html.includes("app.modular.js")) {
  console.error("[build-frontend] sélecteur d'entrée introuvable dans public/index.html (app.modular.js non référencé)");
  process.exit(3);
}

let updated = html.replace(/(<script[^>]+src=["']lib\/[A-Za-z0-9_.\-]+\.js)(\?v=[^"']*)?(["'])/g, `$1?v=${version}$3`);
updated = updated.replace(/(<script[^>]+src=["']components\/[A-Za-z0-9_.\-]+\.js)(\?v=[^"']*)?(["'])/g, `$1?v=${version}$3`);
if (updated === html) {
  console.error("[build-frontend] aucun <script src=\"lib/…\"> ni \"components/…\" à re-versionner dans index.html");
  process.exit(3);
}
fs.writeFileSync(HTML, updated);

const bytes = fs.statSync(OUT).size;
console.log(`[build-frontend] ok — app.js ${bytes.toLocaleString()} bytes, version ${version}`);
