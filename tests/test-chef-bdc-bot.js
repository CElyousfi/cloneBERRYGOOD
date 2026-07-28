/* eslint-disable no-console */
/**
 * Standalone test for chefBdcBot.handleBdcMessage flow.
 * Run with: node tests/test-chef-bdc-bot.js
 *
 * Stubs out firebase and whatsappService by injecting into require.cache
 * BEFORE loading chefBdcBot / bdcValidationService.
 */
const path = require("path");
const Module = require("module");
const FN_DIR = path.join(__dirname, "..", "functions");

const calls = { wa: [], bdcUpdates: [], dispatches: [] };

// ── In-memory Firestore mock ────────────────────────────────────────────────
function makeFirestoreMock() {
  const sessions = new Map();
  const bdcs = new Map();
  function docRef(col, id) {
    return {
      async get() {
        const map = col === "whatsapp_sessions" ? sessions : col === "purchase_orders" ? bdcs : null;
        if (!map) return { exists: false };
        return { exists: map.has(id), data: () => map.get(id) };
      },
      async set(data, opts) {
        const map = col === "whatsapp_sessions" ? sessions : bdcs;
        if (opts && opts.merge) {
          map.set(id, { ...(map.get(id) || {}), ...data });
        } else {
          map.set(id, data);
        }
      },
      async update(patch) {
        const map = col === "whatsapp_sessions" ? sessions : bdcs;
        const existing = map.get(id) || {};
        const merged = { ...existing, ...patch };
        map.set(id, merged);
        if (col === "purchase_orders") calls.bdcUpdates.push({ id, patch });
      },
      async delete() {
        const map = col === "whatsapp_sessions" ? sessions : bdcs;
        map.delete(id);
      },
    };
  }
  const db = {
    collection(col) {
      return { doc: (id) => docRef(col, id) };
    },
  };
  return { db, sessions, bdcs };
}

// ── Stub require cache ──────────────────────────────────────────────────────
function preload(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
    paths: Module._nodeModulePaths(path.dirname(resolved)),
    children: [],
  };
}

const { db, sessions, bdcs } = makeFirestoreMock();
preload(path.join(FN_DIR, "config/firebase.js"), { db, admin: {}, bucket: {} });

const waMock = {
  sendTextMessage: async (to, text) => { calls.wa.push({ kind: "text", to, text }); return { success: true }; },
  sendInteractiveButtons: async (to, body, btns) => { calls.wa.push({ kind: "buttons", to, body, btns }); return { success: true }; },
  sendDocumentMessage: async (to, link, filename, caption) => { calls.wa.push({ kind: "document", to, link, filename, caption }); return { success: true }; },
  sendTemplateMessage: async () => ({ success: true }),
  resolveRecipientsForProfile: async () => [],
  logMessage: async () => {},
  clearConfigCache: () => {},
  formatPhoneE164: (p) => p,
};
preload(path.join(FN_DIR, "whatsappService.js"), waMock);

// Stub dispatcher to noop dispatchNotification (we don't want validateBdcCore
// to trigger downstream WhatsApp sends in this unit test).
preload(path.join(FN_DIR, "notificationDispatcher.js"), {
  dispatchNotification: async (payload) => { calls.dispatches.push(payload); },
  TEMPLATE_MAP: {},
  buildBdcWhatsAppSummary: () => "",
});

// Now require chefBdcBot — its bdcValidationService will pull our stubbed dispatcher.
const chefBdcBot = require(path.join(FN_DIR, "chefBdcBot"));
const { validateBdcCore } = require(path.join(FN_DIR, "bdcValidationService"));

// ── Test helpers ────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

function setupBdc(id, ferme = "F1", status = "en_attente_chef") {
  bdcs.set(id, { numero: `BDC-${id}`, ferme, status, items: [], history: [], total_ttc: 1000 });
}
function setupSession(phone, bdc_id, role = "chef", ferme = "F1", step = "awaiting_decision") {
  sessions.set(phone, {
    phone, flow: "bdc_approval", step,
    data: { bdc_id, role, ferme },
    expiresAt: Date.now() + 30 * 60 * 1000,
  });
}
function reset() { sessions.clear(); bdcs.clear(); calls.wa.length = 0; calls.bdcUpdates.length = 0; calls.dispatches.length = 0; }

const user = { uid: "u1", profileId: "chef", displayName: "Hassan", ferme: "F1" };

// ── Tests ───────────────────────────────────────────────────────────────────
(async () => {
  console.log("\nScenario 1 — Approve via button BDC_APPROVE");
  reset();
  setupBdc("bdc1"); setupSession("+212600000001", "bdc1");
  let handled = await chefBdcBot.handleBdcMessage("+212600000001", user, {
    type: "interactive", interactive: { button_reply: { id: "BDC_APPROVE" } },
  });
  assert(handled === true, "handler returns true");
  assert(bdcs.get("bdc1").status === "en_attente_dg", "BDC moves to en_attente_dg");
  assert(bdcs.get("bdc1").validated_by_chef?.via === "whatsapp", "visa tagged via=whatsapp");
  assert(sessions.has("+212600000001") === false, "session cleared");
  assert(calls.wa.some(c => c.kind === "text" && c.text.includes("validé")), "confirmation sent");

  console.log("\nScenario 2 — Approve via text 'ok' (case insensitive)");
  reset();
  setupBdc("bdc2"); setupSession("+212600000002", "bdc2");
  await chefBdcBot.handleBdcMessage("+212600000002", user, { type: "text", text: { body: "Ok" } });
  assert(bdcs.get("bdc2").status === "en_attente_dg", "approved via text 'ok'");

  console.log("\nScenario 3 — Reject via button → motif prompt → reason");
  reset();
  setupBdc("bdc3"); setupSession("+212600000003", "bdc3");
  await chefBdcBot.handleBdcMessage("+212600000003", user, {
    type: "interactive", interactive: { button_reply: { id: "BDC_REJECT" } },
  });
  assert(sessions.get("+212600000003").step === "awaiting_reject_reason", "step moved to awaiting_reject_reason");
  assert(calls.wa.some(c => c.kind === "text" && c.text.includes("motif")), "motif prompt sent");
  // BDC not yet rejected
  assert(bdcs.get("bdc3").status === "en_attente_chef", "BDC still pending until motif provided");
  // Send motif
  await chefBdcBot.handleBdcMessage("+212600000003", user, { type: "text", text: { body: "Prix trop élevé" } });
  assert(bdcs.get("bdc3").status === "rejete", "BDC rejected after motif");
  const rejetEntry = bdcs.get("bdc3").history.find(h => h.action === "rejet_chef");
  assert(rejetEntry?.by?.comment === "Prix trop élevé", "comment captured in history");
  assert(sessions.has("+212600000003") === false, "session cleared after motif");

  console.log("\nScenario 4 — Unknown text → re-prompt with buttons");
  reset();
  setupBdc("bdc4"); setupSession("+212600000004", "bdc4");
  await chefBdcBot.handleBdcMessage("+212600000004", user, { type: "text", text: { body: "bonjour" } });
  assert(sessions.get("+212600000004").step === "awaiting_decision", "session step unchanged");
  assert(calls.wa.some(c => c.kind === "buttons"), "re-prompt with buttons sent");

  console.log("\nScenario 5 — hasActiveBdcSession");
  reset();
  assert((await chefBdcBot.hasActiveBdcSession("+212600000005")) === false, "no session → false");
  setupBdc("bdc5"); setupSession("+212600000005", "bdc5");
  assert((await chefBdcBot.hasActiveBdcSession("+212600000005")) === true, "active session → true");

  console.log("\nScenario 6 — Wrong farm (chef F1 tries BDC F3)");
  reset();
  setupBdc("bdc6", "F3");
  setupSession("+212600000006", "bdc6", "chef", "F1"); // session built with chef ferme F1, but BDC is F3
  // Manually craft user with ferme F1
  await chefBdcBot.handleBdcMessage("+212600000006", { ...user, ferme: "F1" }, {
    type: "interactive", interactive: { button_reply: { id: "BDC_APPROVE" } },
  });
  assert(bdcs.get("bdc6").status === "en_attente_chef", "BDC unchanged when farm mismatch");
  assert(calls.wa.some(c => c.kind === "text" && c.text.includes("impossible")), "rejection message sent");

  console.log("\nScenario 7 — BDC already validated elsewhere");
  reset();
  setupBdc("bdc7", "F1", "valide_dg"); // already DG-approved
  setupSession("+212600000007", "bdc7");
  await chefBdcBot.handleBdcMessage("+212600000007", user, {
    type: "interactive", interactive: { button_reply: { id: "BDC_APPROVE" } },
  });
  assert(calls.wa.some(c => c.kind === "text" && c.text.includes("déjà été traité")), "duplicate detection message");
  assert(sessions.has("+212600000007") === false, "session cleared on duplicate");

  console.log("\nScenario 8 — DG approval via WhatsApp");
  reset();
  bdcs.set("bdc8", { numero: "BDC-8", ferme: "F1", status: "en_attente_dg", items: [], history: [], total_ttc: 5000, mode_paiement: "comptant_especes" });
  setupSession("+212600000008", "bdc8", "dg", null);
  const dgUser = { uid: "u2", profileId: "dg", displayName: "DG" };
  await chefBdcBot.handleBdcMessage("+212600000008", dgUser, {
    type: "interactive", interactive: { button_reply: { id: "BDC_APPROVE" } },
  });
  assert(bdcs.get("bdc8").status === "valide_dg", "DG approval → valide_dg");

  console.log("\nScenario 9 — Finance confirms virement saisi (button)");
  reset();
  bdcs.set("bdc9", { numero: "BDC-9", ferme: "F1", status: "valide_dg", items: [], history: [], total_ttc: 3000, mode_paiement: "virement_bancaire" });
  sessions.set("+212600000009", { phone: "+212600000009", flow: "virement_lance", step: "awaiting_decision", data: { bdc_id: "bdc9" }, expiresAt: Date.now() + 600000 });
  const finUser = { uid: "u3", profileId: "finance", displayName: "Finance" };
  await chefBdcBot.handleBdcMessage("+212600000009", finUser, {
    type: "interactive", interactive: { button_reply: { id: "VIREMENT_SAISI" } },
  });
  assert(bdcs.get("bdc9").status === "virement_lance", "BDC → virement_lance");
  assert(bdcs.get("bdc9").virement_lance_by?.via === "whatsapp", "via=whatsapp recorded");
  assert(sessions.has("+212600000009") === false, "session cleared");

  console.log("\nScenario 10 — Finance confirms via text 'saisi'");
  reset();
  bdcs.set("bdc10", { numero: "BDC-10", ferme: "F1", status: "valide_dg", items: [], history: [], total_ttc: 1500, mode_paiement: "comptant_virement" });
  sessions.set("+212600000010", { phone: "+212600000010", flow: "virement_lance", step: "awaiting_decision", data: { bdc_id: "bdc10" }, expiresAt: Date.now() + 600000 });
  await chefBdcBot.handleBdcMessage("+212600000010", finUser, { type: "text", text: { body: "Saisi" } });
  assert(bdcs.get("bdc10").status === "virement_lance", "Finance text 'saisi' → virement_lance");

  console.log("\nScenario 11 — DG confirms virement signed (button)");
  reset();
  bdcs.set("bdc11", { numero: "BDC-11", ferme: "F1", status: "virement_lance", items: [], history: [], total_ttc: 2200, mode_paiement: "virement_bancaire" });
  sessions.set("+212600000011", { phone: "+212600000011", flow: "virement_signe", step: "awaiting_decision", data: { bdc_id: "bdc11" }, expiresAt: Date.now() + 600000 });
  await chefBdcBot.handleBdcMessage("+212600000011", { uid: "u4", profileId: "dg", displayName: "DG" }, {
    type: "interactive", interactive: { button_reply: { id: "VIREMENT_SIGNED" } },
  });
  assert(bdcs.get("bdc11").status === "virement_signe", "BDC → virement_signe");

  console.log("\nScenario 12 — DG confirms via text 'signé'");
  reset();
  bdcs.set("bdc12", { numero: "BDC-12", ferme: "F1", status: "virement_lance", items: [], history: [], total_ttc: 800, mode_paiement: "virement_bancaire" });
  sessions.set("+212600000012", { phone: "+212600000012", flow: "virement_signe", step: "awaiting_decision", data: { bdc_id: "bdc12" }, expiresAt: Date.now() + 600000 });
  await chefBdcBot.handleBdcMessage("+212600000012", { uid: "u4", profileId: "dg", displayName: "DG" }, { type: "text", text: { body: "Signé" } });
  assert(bdcs.get("bdc12").status === "virement_signe", "DG text 'signé' → virement_signe");

  console.log("\nScenario 13 — virement_lance flow: unknown text re-prompts");
  reset();
  bdcs.set("bdc13", { numero: "BDC-13", ferme: "F1", status: "valide_dg", items: [], history: [], total_ttc: 100, mode_paiement: "virement_bancaire" });
  sessions.set("+212600000013", { phone: "+212600000013", flow: "virement_lance", step: "awaiting_decision", data: { bdc_id: "bdc13" }, expiresAt: Date.now() + 600000 });
  await chefBdcBot.handleBdcMessage("+212600000013", finUser, { type: "text", text: { body: "hmm" } });
  assert(bdcs.get("bdc13").status === "valide_dg", "BDC unchanged on unknown text");
  assert(calls.wa.some(c => c.kind === "buttons"), "re-prompt sent");

  console.log("\nScenario 14 — virement_signe rejects when status mismatch");
  reset();
  bdcs.set("bdc14", { numero: "BDC-14", ferme: "F1", status: "valide_dg", items: [], history: [], total_ttc: 100, mode_paiement: "virement_bancaire" });
  sessions.set("+212600000014", { phone: "+212600000014", flow: "virement_signe", step: "awaiting_decision", data: { bdc_id: "bdc14" }, expiresAt: Date.now() + 600000 });
  await chefBdcBot.handleBdcMessage("+212600000014", { uid: "u5", profileId: "dg", displayName: "DG" }, {
    type: "interactive", interactive: { button_reply: { id: "VIREMENT_SIGNED" } },
  });
  assert(bdcs.get("bdc14").status === "valide_dg", "BDC unchanged when status mismatch");
  assert(calls.wa.some(c => c.kind === "text" && c.text.includes("statut")), "status warning sent");

  console.log("\nScenario 15 — Chef approve with pdf_url dispatches bdc_chef_approved_doc");
  reset();
  setupBdc("bdc15");
  bdcs.set("bdc15", { ...bdcs.get("bdc15"), pdf_url: "https://example.com/bdc15.pdf" });
  await validateBdcCore({ id: "bdc15", decision: "approve", role: "chef", profileId: "chef", name: "Hassan" });
  const dispatch15 = calls.dispatches.find(d => d.data?.bdc_id === "bdc15");
  assert(!!dispatch15, "dispatch recorded for bdc15");
  assert(dispatch15?.type === "bdc_chef_approved_doc", "type is bdc_chef_approved_doc when pdf_url present");
  assert(dispatch15?.document?.link === "https://example.com/bdc15.pdf", "document.link matches pdf_url");
  assert(dispatch15?.document?.filename?.includes("BDC-bdc15") || dispatch15?.document?.filename?.includes(bdcs.get("bdc15").numero), "document.filename contains BDC numero");

  console.log("\nScenario 16 — Chef approve without pdf_url dispatches bdc_chef_approved");
  reset();
  setupBdc("bdc16");
  await validateBdcCore({ id: "bdc16", decision: "approve", role: "chef", profileId: "chef", name: "Hassan" });
  const dispatch16 = calls.dispatches.find(d => d.data?.bdc_id === "bdc16");
  assert(!!dispatch16, "dispatch recorded for bdc16");
  assert(dispatch16?.type === "bdc_chef_approved", "type is bdc_chef_approved when no pdf_url");
  assert(!("document" in (dispatch16 || {})), "no document key in payload when no pdf_url");

  console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
