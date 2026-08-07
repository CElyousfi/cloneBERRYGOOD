/**
 * Berry Good Dashboard — Smoke Test Post-Deploy
 *
 * Validates data integrity and coherence after each deployment.
 * Not just "!= 0" — checks cross-source consistency, reasonable ranges,
 * farm coverage, and sync freshness.
 *
 * Usage:
 *   npm run smoke
 *   BASE_URL=https://berrygood-farms-dashboard.web.app node tests/smoke-test.js
 *
 * AUTH (suites 2-4, endpoints protégés) : QA_TEST_EMAIL / QA_TEST_PASSWORD
 * lus depuis .env (gitignored). Sans credentials, ces suites sont ignorées
 * proprement (le test reste exécutable sans .env).
 */

const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch (_e) {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    });
  }
}

const BASE_URL = process.env.BASE_URL || "https://berrygood-farms-dashboard.web.app";
const QA_EMAIL = process.env.QA_TEST_EMAIL;
const QA_PASSWORD = process.env.QA_TEST_PASSWORD;

let passed = 0;
let failed = 0;
let warned = 0;
const errors = [];
let authToken = null;

// --- Helpers ---

function readFirebaseApiKey() {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const m = html.match(/apiKey:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

async function authenticate() {
  if (!QA_EMAIL || !QA_PASSWORD) {
    console.log("\n⚠️  QA_TEST_EMAIL/QA_TEST_PASSWORD absents — suites 2-4 ignorées faute de credentials.");
    return null;
  }
  const apiKey = readFirebaseApiKey();
  if (!apiKey) {
    console.log("\n⚠️  apiKey Firebase introuvable dans public/index.html — suites 2-4 ignorées.");
    return null;
  }
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: QA_EMAIL, password: QA_PASSWORD, returnSecureToken: true }),
      }
    );
    const json = await res.json();
    if (!res.ok || !json.idToken) {
      console.log(`\n⚠️  Auth QA échouée (${res.status}) : ${json.error?.message || "erreur inconnue"} — suites 2-4 ignorées.`);
      return null;
    }
    console.log("\n✅ Auth QA réussie — suites 2-4 activées.");
    return json.idToken;
  } catch (err) {
    console.log(`\n⚠️  Auth QA échouée : ${err.message} — suites 2-4 ignorées.`);
    return null;
  }
}

async function api(path, timeoutMs = 15000) {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, elapsed: Date.now() - start };
  } catch (err) {
    return { status: 0, json: {}, elapsed: Date.now() - start, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function warmup(timeoutMs = 60000) {
  console.log("\n═══ Préchauffe (/api/health) ═══");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - start);
    const r = await api("/api/health", Math.min(10000, remaining));
    if (r.status > 0) {
      console.log(`  ✅ API réveillée — status=${r.status} (${Date.now() - start}ms)`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.log(`  ⚠️  Préchauffe: pas de réponse après ${timeoutMs}ms — on lance quand même les suites`);
}

function assert(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}` + (detail ? ` — ${detail}` : ""));
    failed++;
    errors.push({ name, detail });
  }
}

function warn(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ⚠️  ${name}` + (detail ? ` — ${detail}` : ""));
    warned++;
  }
}

function isWorkday() {
  // Morocco: Mon-Sat work, Sunday off
  const now = new Date();
  return now.getDay() !== 0; // 0 = Sunday
}

function daysSince(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

const WORKDAY = isWorkday();
const KNOWN_FERMES = ["F1", "F5", "Avocatier"];

// =========================================================
// Suite 1: API Health & Response Times
// =========================================================
async function suiteApiHealth() {
  console.log("\n═══ Suite 1: Santé des APIs ═══");

  const endpoints = [
    "/api/health",
    "/api/pointage-rh?action=dates",
    "/api/pointage-rh?action=summary",
    "/api/pointage-rh?action=recolte",
    "/api/dashboard",
    "/api/parcelles",
  ];

  const results = await Promise.all(endpoints.map(e => api(e)));

  results.forEach((r, i) => {
    const path = endpoints[i].replace("/api/", "");
    if (r.error) {
      assert(`${path} accessible`, false, r.error);
    } else if (r.status === 401) {
      // Auth-protected endpoint responding correctly
      assert(`${path} → 401 auth protégé (${r.elapsed}ms)`, true);
    } else {
      assert(`${path} → 200 + success (${r.elapsed}ms)`, r.status === 200 && r.json.success === true, `status=${r.status}`);
    }
  });

  // No 500 errors
  const has500 = results.some(r => r.status === 500);
  assert("Aucune erreur 500", !has500);

  // Response time (generous: post-deploy cold start)
  const maxElapsed = Math.max(...results.map(r => r.elapsed));
  warn("Temps de réponse max < 10s", maxElapsed < 10000, `max=${Math.round(maxElapsed / 1000)}s`);

  return { health: results[0], dates: results[1], summary: results[2], recolte: results[3] };
}

// =========================================================
// Suite 2: Data Freshness
// =========================================================
async function suiteSyncFreshness(healthResult, datesResult) {
  console.log("\n═══ Suite 2: Fraîcheur des Données ═══");

  // Sync status from health
  const sync = healthResult?.json?.syncStatus;
  if (sync) {
    const maxAge = WORKDAY ? 2 * 60 * 60 * 1000 : 48 * 60 * 60 * 1000;
    const maxLabel = WORKDAY ? "2h" : "48h";
    const age = sync.dataAgeMs || Infinity;
    assert(`Sync fraîcheur < ${maxLabel}`, age < maxAge, `âge=${sync.dataAge || Math.round(age / 3600000) + "h"}`);
  } else {
    warn("syncStatus disponible dans /api/health", false, "champ manquant");
  }

  // Recent dates (skip if auth-protected)
  const dates = datesResult?.json?.dates || [];
  if (datesResult?.status === 401) {
    console.log("  ⏭️  Endpoints protégés par auth — tests de données ignorés");
    return dates;
  }
  assert("Dates disponibles non vides", dates.length > 0, `${dates.length} dates`);

  if (dates.length > 0) {
    const mostRecent = dates[0].date;
    const daysAgo = daysSince(mostRecent);
    const maxDays = WORKDAY ? 3 : 5;
    assert(`Date la plus récente < ${maxDays} jours`, daysAgo <= maxDays, `${mostRecent} = il y a ${daysAgo}j`);

    // At least one date with real workforce
    const hasRealData = dates.some(d => (d.nbOuv || d.total || 0) >= 10);
    assert("Au moins 1 date avec >= 10 ouvriers", hasRealData);
  }

  return dates;
}

// =========================================================
// Suite 3: Cross-Source Consistency (the core)
// =========================================================
async function suiteCrossSource(summaryResult, recolteResult, dates) {
  console.log("\n═══ Suite 3: Cohérence Inter-Sources ═══");

  // Use most recent date for detailed checks (override diagnostic via SMOKE_TEST_DATE)
  const testDate = process.env.SMOKE_TEST_DATE || dates?.[0]?.date;
  if (!testDate) {
    console.log("  ⏭️  Pas de date disponible — suite ignorée");
    return;
  }

  // Fetch fresh data for the most recent date if not already for that date
  const [summaryRes, recolteRes] = await Promise.all([
    api(`/api/pointage-rh?action=summary&date=${testDate}`),
    api(`/api/pointage-rh?action=recolte&date=${testDate}`),
  ]);

  const summary = summaryRes.json;
  const recolte = recolteRes.json;

  // --- Farm Coverage ---
  const pointageJour = summary.pointageJour || [];
  const fermes = pointageJour.map(f => f.ferme);

  assert("F1 présente dans pointage", fermes.includes("F1"), `fermes: [${fermes.join(", ")}]`);
  assert("F5 présente dans pointage", fermes.includes("F5"), `fermes: [${fermes.join(", ")}]`);

  // No "Autre" dominance
  const autreEntry = pointageJour.find(f => f.ferme === "Autre");
  const f1Entry = pointageJour.find(f => f.ferme === "F1");
  if (autreEntry && f1Entry) {
    warn("'Autre' ne domine pas F1", (autreEntry.total || 0) < (f1Entry.total || 0),
      `Autre=${autreEntry.total}, F1=${f1Entry.total}`);
  }

  // Ouvrier counts per farm (relaxed on weekends). Une ferme peut légitimement
  // être à 0 ouvrier un jour donné (jour de repos propre à cette ferme) — on
  // exige qu'au moins 2 fermes connues soient actives, pas toutes ; les fermes
  // à 0 sont signalées en avertissement, pas en échec.
  if (WORKDAY) {
    const minOuv = 10;
    const knownEntries = pointageJour.filter(f => KNOWN_FERMES.includes(f.ferme));
    const activeFermes = knownEntries.filter(f => (f.total || 0) >= minOuv);
    assert(`Au moins 2 fermes >= ${minOuv} ouvriers`, activeFermes.length >= 2,
      `actives: [${activeFermes.map(f => f.ferme).join(", ")}] / connues: [${knownEntries.map(f => f.ferme).join(", ")}]`);
    knownEntries.forEach(f => {
      warn(`${f.ferme}: >= ${minOuv} ouvriers`, (f.total || 0) >= minOuv,
        `${f.ferme} a ${f.total || 0} ouvriers`);
    });
  }

  // Cost per worker reasonableness
  pointageJour.filter(f => KNOWN_FERMES.includes(f.ferme) && f.total > 0).forEach(f => {
    const coutParOuv = (f.cout || 0) / f.total;
    warn(`${f.ferme}: coût/ouvrier raisonnable (50-500 DH)`, coutParOuv >= 50 && coutParOuv <= 500,
      `${Math.round(coutParOuv)} DH/ouv`);
  });

  // --- Cross-check Pointage vs Cueillette ---
  const workers = recolte.workers || [];
  const cueillette = recolte.cueillette || [];
  const totalKgCueillette = recolte.totalKgCueillette || 0;
  const recolteCount = recolte.count ?? cueillette.length;

  // Une période sans récolte est normale (pas de cueillette en cours) —
  // ce n'est plus une assertion, juste une info.
  warn("Workers (pointage) non vide", workers.length > 0, `${workers.length} workers`);
  warn("Cueillette non vide", cueillette.length > 0, `${cueillette.length} entrées`);

  // Ce qui serait vraiment anormal : un count de cueillette qui ne correspond
  // pas à un tonnage (ou l'inverse) — incohérence interne de l'endpoint, pas
  // une simple absence de récolte.
  assert("Cohérence count ↔ totalKgCueillette", (recolteCount > 0) === (totalKgCueillette > 0),
    `count=${recolteCount}, totalKgCueillette=${totalKgCueillette}`);

  if (workers.length > 0 && totalKgCueillette > 0) {
    // kg per worker per day
    const kgParOuv = totalKgCueillette / workers.length;
    assert("Kg/ouvrier/jour entre 5 et 150", kgParOuv >= 5 && kgParOuv <= 150,
      `${Math.round(kgParOuv * 10) / 10} kg/ouv`);

    // Ratio cueillette vs pointage (1.5x factor makes exact match impossible)
    const totalKgPointage = workers.reduce((s, w) => s + (w.quantite || 0), 0);
    if (totalKgPointage > 0) {
      const ratio = totalKgCueillette / totalKgPointage;
      warn("Ratio cueillette/pointage entre 0.5x et 3x", ratio >= 0.5 && ratio <= 3,
        `ratio=${Math.round(ratio * 100) / 100}x`);
    }
  }

  // --- Cueillette integrity ---
  if (cueillette.length > 0) {
    const emptyParcelles = cueillette.filter(c => !c.parcelle || c.parcelle.trim() === "");
    assert("Toutes les cueillettes ont une parcelle", emptyParcelles.length === 0,
      `${emptyParcelles.length} sans parcelle`);

    const badFermes = cueillette.filter(c => c.ferme && !KNOWN_FERMES.includes(c.ferme));
    warn("Fermes cueillette valides (F1/F5/Avocatier)", badFermes.length === 0,
      `${badFermes.length} entrées avec ferme="${badFermes[0]?.ferme}"`);

    // Both F1 and F5 in cueillette
    const cueilFermes = [...new Set(cueillette.map(c => c.ferme))];
    const checkFerme = WORKDAY ? assert : warn;
    checkFerme("F1 présente dans cueillette", cueilFermes.includes("F1"), `fermes: [${cueilFermes.join(", ")}]`);
    checkFerme("F5 présente dans cueillette", cueilFermes.includes("F5"), `fermes: [${cueilFermes.join(", ")}]`);

    // Kg > 0 for each farm in cueillette
    const kgByFerme = {};
    cueillette.forEach(c => {
      kgByFerme[c.ferme] = (kgByFerme[c.ferme] || 0) + (c.totalKg || 0);
    });
    Object.entries(kgByFerme).filter(([ferme]) => KNOWN_FERMES.includes(ferme)).forEach(([ferme, kg]) => {
      checkFerme(`${ferme}: kg cueillette > 0`, kg > 0, `${ferme} = ${Math.round(kg)} kg`);
    });
  }
}

// =========================================================
// Suite 4: Worker-Level Reasonableness
// =========================================================
async function suiteWorkerReasonableness(dates) {
  console.log("\n═══ Suite 4: Vraisemblance Ouvriers ═══");

  const testDate = process.env.SMOKE_TEST_DATE || dates?.[0]?.date;
  if (!testDate) {
    console.log("  ⏭️  Pas de date — suite ignorée");
    return;
  }

  if (!WORKDAY) {
    console.log("  ⏭️  Dimanche — suite relâchée");
    return;
  }

  const res = await api(`/api/pointage-rh?action=recolte&date=${testDate}`);
  const workers = res.json.workers || [];

  if (workers.length === 0) {
    warn("Workers disponibles pour vérification", false, "aucun worker");
    return;
  }

  // Sample first 20 workers for spot checks
  const sample = workers.slice(0, 20);

  // Hours range (4-12)
  const withHours = sample.filter(w => w.heures > 0);
  if (withHours.length > 0) {
    const badHours = withHours.filter(w => w.heures < 4 || w.heures > 12);
    assert("Heures/ouvrier entre 4 et 12", badHours.length === 0,
      badHours.length > 0 ? `${badHours[0].nom}: ${badHours[0].heures}h` : "");
  }

  // Cost range (50-500 DH)
  const withCout = sample.filter(w => (w.cout || 0) > 0);
  if (withCout.length > 0) {
    const badCout = withCout.filter(w => w.cout < 30 || w.cout > 600);
    warn("Coût/ouvrier entre 30 et 600 DH", badCout.length === 0,
      badCout.length > 0 ? `${badCout[0].nom}: ${badCout[0].cout} DH` : "");
  }

  // Parcelle-ferme alignment
  const misaligned = workers.filter(w => {
    if (!w.parcelle || !w.ferme) return false;
    const p = w.parcelle.toUpperCase();
    if (p.includes("F1") && w.ferme !== "F1") return true;
    if (p.includes("F5") && w.ferme !== "F5") return true;
    return false;
  });
  assert("Alignement parcelle↔ferme", misaligned.length === 0,
    misaligned.length > 0 ? `${misaligned.length} désalignés (ex: ${misaligned[0]?.parcelle} → ${misaligned[0]?.ferme})` : "");

  // No duplicate matricule with wildly different costs
  const byMatricule = {};
  workers.forEach(w => {
    if (!byMatricule[w.matricule]) byMatricule[w.matricule] = [];
    byMatricule[w.matricule].push(w);
  });
  const duplicatesWithDivergence = Object.values(byMatricule)
    .filter(arr => arr.length > 1)
    .filter(arr => {
      const costs = arr.map(w => w.cout || 0).filter(c => c > 0);
      if (costs.length < 2) return false;
      return Math.max(...costs) / Math.min(...costs) > 2;
    });
  assert("Pas de matricule avec coûts divergents (>2x)", duplicatesWithDivergence.length === 0,
    duplicatesWithDivergence.length > 0 ? `${duplicatesWithDivergence.length} matricules suspects` : "");
}

// =========================================================
// MAIN
// =========================================================
async function main() {
  const dayName = new Date().toLocaleDateString("fr-FR", { weekday: "long" });
  const dateStr = new Date().toISOString().slice(0, 10);

  console.log(`\n╔═══════════════════════════════════════════════╗`);
  console.log(`║  Berry Good — Smoke Test Post-Deploy          ║`);
  console.log(`╚═══════════════════════════════════════════════╝`);
  console.log(`Cible: ${BASE_URL}`);
  console.log(`Mode: ${WORKDAY ? "JOUR OUVRÉ" : "DIMANCHE"} (${dayName})  |  Date: ${dateStr}`);

  try {
    // Auth QA (suites 2-4) — se fait avant la préchauffe pour que le warmup
    // /api/health parte déjà avec le token si présent
    authToken = await authenticate();

    // Préchauffe: laisse le temps au cold start avant de lancer les suites chronométrées
    await warmup();

    // Suite 1: API Health
    const { health, dates: datesRes, summary, recolte } = await suiteApiHealth();

    // Suite 2: Sync Freshness
    const dates = await suiteSyncFreshness(health, datesRes);

    // Suite 3: Cross-Source Consistency
    await suiteCrossSource(summary, recolte, dates);

    // Suite 4: Worker Reasonableness
    await suiteWorkerReasonableness(dates);

  } catch (err) {
    console.error(`\n❌ Erreur fatale: ${err.message}`);
    if (err.cause?.code === "ECONNREFUSED") {
      console.error("\n➡️  Le site n'est pas accessible.");
    }
    failed++;
  }

  console.log(`\n══════════════════════════════════════`);
  console.log(`Résultat: ${passed} ✅  ${failed} ❌  ${warned} ⚠️`);
  if (errors.length) {
    console.log("\nÉchecs:");
    errors.forEach(e => console.log(`  - ${e.name}: ${e.detail || "assertion failed"}`));
  }
  console.log(`══════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
