/**
 * Berry Good Dashboard — Workflow Tests
 *
 * Usage:
 *   1. Start emulator:  firebase emulators:start
 *   2. Run tests:       node tests/test-workflows.js
 *
 * Or target production:
 *   BASE_URL=https://berrygood-farms-dashboard.web.app node tests/test-workflows.js
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

let passed = 0;
let failed = 0;
const errors = [];

async function api(path, opts = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function assert(name, condition, detail) {
  if (condition) {
    console.log(`  \u2705 ${name}`);
    passed++;
  } else {
    console.log(`  \u274c ${name}` + (detail ? ` — ${detail}` : ""));
    failed++;
    errors.push({ name, detail });
  }
}

// =========================================================
// Test Suite 1: Health & Basic Endpoints
// =========================================================
async function testBasicEndpoints() {
  console.log("\n\u2550\u2550\u2550 Test 1: Endpoints de base \u2550\u2550\u2550");

  // Health check
  const health = await api("/api/health");
  assert("GET /api/health retourne success", health.json.success === true);

  // Pointage dates
  const dates = await api("/api/pointage-rh?action=dates");
  assert("GET pointage dates retourne success", dates.json.success === true);
  assert("pointage dates contient un tableau", Array.isArray(dates.json.dates));

  // Validation status (date quelconque)
  const testDate = dates.json.dates?.[0]?.date || "2026-03-01";
  const valStatus = await api(`/api/validation?action=status&date=${testDate}`);
  assert("GET validation status retourne success", valStatus.json.success === true);

  // Pointage summary
  const summary = await api(`/api/pointage-rh?action=summary&date=${testDate}`);
  assert("GET pointage summary retourne success", summary.json.success === true);
}

// =========================================================
// Test Suite 2: Pointage Validation Workflow
// =========================================================
async function testPointageWorkflow() {
  console.log("\n\u2550\u2550\u2550 Test 2: Workflow Pointage Validation \u2550\u2550\u2550");

  const testDate = "2099-01-01"; // Date fictive pour ne pas polluer
  const testFerme = "F1";

  // Cleanup: unlock if exists
  await api("/api/validation?action=unlock", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, profileId: "dg" }),
  });

  // 1. Quinzaine status
  const qs = await api("/api/validation?action=quinzaine-status");
  assert("quinzaine-status retourne periodes[]", Array.isArray(qs.json.periodes));
  assert("quinzaine-status retourne validations{}", typeof qs.json.validations === "object");

  // 2. RH soumet
  const rhSubmit = await api("/api/validation?action=validate", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, role: "rh", profileId: "rh", comment: "Test RH" }),
  });
  assert("RH soumet pointage -> success", rhSubmit.json.success === true);
  assert("visaRH est set", rhSubmit.json.validation?.visaRH != null);

  // 3. Caporal valide SANS piece jointe -> erreur 400
  const capNoPJ = await api("/api/validation?action=validate", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, role: "caporal", profileId: "caporal_f1" }),
  });
  assert("Caporal sans PJ -> erreur 400", capNoPJ.status === 400);
  assert("Message mentionne piece jointe", (capNoPJ.json.error || "").includes("jointe"));

  // 4. Caporal valide AVEC piece jointe
  const capWithPJ = await api("/api/validation?action=validate", {
    method: "POST",
    body: JSON.stringify({
      date: testDate, ferme: testFerme, role: "caporal", profileId: "caporal_f1",
      pieceJointeUrl: "https://example.com/test-scan.jpg",
      pieceJointeFilename: "pointage-papier.jpg",
    }),
  });
  assert("Caporal avec PJ -> success", capWithPJ.json.success === true);
  assert("visaCaporal est set", capWithPJ.json.validation?.visaCaporal != null);
  assert("pieceJointeUrl enregistre", capWithPJ.json.validation?.pieceJointeUrl === "https://example.com/test-scan.jpg");

  // 5. Chef valide -> verrouille
  const chefVal = await api("/api/validation?action=validate", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, role: "chef", profileId: "chef_f1", comment: "OK Chef" }),
  });
  assert("Chef valide -> success", chefVal.json.success === true);
  assert("locked = true", chefVal.json.validation?.locked === true);

  // 6. RH tente unlock -> refus (pas rejeté, pas DG)
  const rhUnlock = await api("/api/validation?action=unlock", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, profileId: "rh" }),
  });
  assert("RH unlock sur pointage validé -> erreur 403", rhUnlock.status === 403);

  // 7. DG peut unlock
  const dgUnlock = await api("/api/validation?action=unlock", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, profileId: "dg" }),
  });
  assert("DG unlock -> success", dgUnlock.json.success === true);

  // 8. SQL comparison
  const comp = await api("/api/validation?action=sql-comparison");
  assert("sql-comparison retourne comparisons[]", Array.isArray(comp.json.comparisons));

  // Cleanup
  await api("/api/validation?action=unlock", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, profileId: "dg" }),
  });
}

// =========================================================
// Test Suite 3: Rejection Workflow
// =========================================================
async function testRejectionWorkflow() {
  console.log("\n\u2550\u2550\u2550 Test 3: Workflow Rejet Pointage \u2550\u2550\u2550");

  const testDate = "2099-01-02";
  const testFerme = "F5";

  // Cleanup
  await api("/api/validation?action=unlock", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, profileId: "dg" }),
  });

  // RH soumet
  await api("/api/validation?action=validate", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, role: "rh", profileId: "rh" }),
  });

  // Caporal rejette sans commentaire -> erreur
  const rejectNoComment = await api("/api/validation?action=reject", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, role: "caporal", profileId: "caporal_f5" }),
  });
  assert("Rejet sans motif -> erreur 400", rejectNoComment.status === 400);

  // Caporal rejette avec commentaire
  const reject = await api("/api/validation?action=reject", {
    method: "POST",
    body: JSON.stringify({
      date: testDate, ferme: testFerme, role: "caporal", profileId: "caporal_f5",
      comment: "Erreur sur equipe 3, 2 ouvriers manquants",
    }),
  });
  assert("Rejet avec motif -> success", reject.json.success === true);
  assert("rejected = true", reject.json.validation?.rejected === true);
  assert("rejectionComment enregistre", reject.json.validation?.rejectionComment?.includes("equipe 3"));
  assert("visaRH effacé après rejet Caporal", reject.json.validation?.visaRH == null);

  // RH peut re-soumettre après rejet
  const resubmit = await api("/api/validation?action=validate", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, role: "rh", profileId: "rh", comment: "Corrigé" }),
  });
  assert("RH re-soumet après rejet -> success", resubmit.json.success === true);
  assert("rejected reset à false", resubmit.json.validation?.rejected === false);

  // Cleanup
  await api("/api/validation?action=unlock", {
    method: "POST",
    body: JSON.stringify({ date: testDate, ferme: testFerme, profileId: "dg" }),
  });
}

// =========================================================
// Test Suite 4: Demande d'Achat (DA) Workflow
// =========================================================
async function testDAWorkflow() {
  console.log("\n\u2550\u2550\u2550 Test 4: Workflow Demande d'Achat \u2550\u2550\u2550");

  // 1. Créer DA
  const createDA = await api("/api/stock?action=create-da", {
    method: "POST",
    body: JSON.stringify({
      ferme: "F1",
      urgence: "normale",
      justification: "Test automatique workflow DA",
      items: [
        { article: "Engrais NPK", categorie: "engrais", quantite: 100, unite: "kg", note: "Test" },
        { article: "Sécateur", categorie: "outillage", quantite: 5, unite: "U", note: "" },
      ],
      created_by: { profileId: "chef_f1", name: "Test Chef" },
    }),
  });
  assert("Création DA -> success", createDA.json.success === true);
  assert("DA a un numéro", !!createDA.json.numero);
  const daId = createDA.json.id;

  // 2. Lister les DA (sans filtre ferme pour eviter index manquant)
  const listDA = await api("/api/stock?action=list-da");
  assert("Liste DA -> success", listDA.json.success === true);
  assert("DA créée visible dans la liste", listDA.json.das?.some((d) => d.id === daId));

  // 3. DA sans items -> erreur
  const badDA = await api("/api/stock?action=create-da", {
    method: "POST",
    body: JSON.stringify({ ferme: "F1", items: [] }),
  });
  assert("DA sans items -> erreur 400", badDA.status === 400);

  // 4. Approuver DA -> crée BDC automatiquement
  if (daId) {
    const approveDA = await api("/api/stock?action=update-da", {
      method: "POST",
      body: JSON.stringify({
        id: daId,
        status: "approuvee",
        updated_by: { profileId: "achats", name: "Test Achats" },
        comment: "Approuvé par test",
      }),
    });
    assert("Approbation DA -> success", approveDA.json.success === true);
    assert("BDC créé automatiquement", approveDA.json.bdc_created === true);
    assert("BDC a un numéro", !!approveDA.json.bdc_numero);

    // 5. Vérifier DA mise à jour
    const updatedDA = await api("/api/stock?action=list-da");
    const da = updatedDA.json.das?.find((d) => d.id === daId);
    assert("DA status = approuvee", da?.status === "approuvee");
    assert("DA liée au BDC", !!da?.bdc_numero);

    // 6. Cleanup: supprimer la DA et le BDC de test
    // (pas de delete endpoint, on laisse — les données de test ont "Test automatique" dans justification)
  }
}

// =========================================================
// Test Suite 5: BDC Workflow
// =========================================================
async function testBDCWorkflow() {
  console.log("\n\u2550\u2550\u2550 Test 5: Workflow BDC (Bon de Commande) \u2550\u2550\u2550");

  const listBDC = await api("/api/stock?action=list-bdc");
  assert("Liste BDC -> success", listBDC.json.success === true);
  assert("BDC retourne un tableau", Array.isArray(listBDC.json.bdcs || listBDC.json.bdc));

  // Trouver un BDC brouillon pour tester la soumission
  const bdcList = listBDC.json.bdcs || listBDC.json.bdc || [];
  const brouillon = bdcList.find((b) => b.status === "brouillon");
  if (brouillon) {
    console.log(`  (BDC brouillon trouvé: ${brouillon.numero})`);
  } else {
    console.log("  (Aucun BDC brouillon trouvé — tests de soumission sautés)");
  }
}

// =========================================================
// Test Suite 6: Fournisseurs
// =========================================================
async function testFournisseurs() {
  console.log("\n\u2550\u2550\u2550 Test 6: Fournisseurs \u2550\u2550\u2550");

  const list = await api("/api/stock?action=list-suppliers");
  assert("Liste fournisseurs -> success", list.json.success === true);
  assert("Fournisseurs retourne un tableau", Array.isArray(list.json.suppliers));
}

// =========================================================
// MAIN
// =========================================================
async function main() {
  console.log(`\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
  console.log(`\u2551  Berry Good Dashboard — Tests Workflow  \u2551`);
  console.log(`\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d`);
  console.log(`Target: ${BASE_URL}`);

  try {
    await testBasicEndpoints();
    await testPointageWorkflow();
    await testRejectionWorkflow();
    await testDAWorkflow();
    await testBDCWorkflow();
    await testFournisseurs();
  } catch (err) {
    console.error("\n\u274c Erreur fatale:", err.message);
    if (err.cause?.code === "ECONNREFUSED") {
      console.error("\n\u27a1\ufe0f  L'app ne tourne pas. Lancez d'abord: firebase emulators:start");
    }
    failed++;
  }

  console.log(`\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`);
  console.log(`R\u00e9sultats: ${passed} \u2705  ${failed} \u274c`);
  if (errors.length) {
    console.log("\n\u00c9checs:");
    errors.forEach((e) => console.log(`  - ${e.name}: ${e.detail || "assertion failed"}`));
  }
  console.log(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
