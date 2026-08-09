/**
 * dgAgent.js — Agentic LLM for the DG WhatsApp bot.
 *
 * Claude Sonnet 4.6 with tools that read SmartBerry data (récolte for now).
 * Returns a short text reply suitable for WhatsApp.
 *
 * History is passed in by the caller and persists in whatsapp_sessions.data.history.
 */

const { db } = require("./config/firebase");
const firestoreDataService = require("./firestoreDataService");
const forecastService = require("./forecastService");

const MAX_ITERATIONS = 4;
const MAX_HISTORY = 12; // 6 user/assistant pairs
const MODEL_CANDIDATES = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-7"];

const TOOLS = [
  {
    name: "get_recolte_du_jour",
    description: "Récupère la récolte d'une journée: total kg, total caisses, détail par travailleur et par variété. Si la date n'est pas donnée, utilise aujourd'hui.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date au format YYYY-MM-DD. Optionnel — défaut: aujourd'hui." },
      },
    },
  },
  {
    name: "get_recolte_periode",
    description: "Récupère la récolte agrégée sur une période (ex: semaine, mois). Renvoie kg total, top variétés, nombre de jours actifs.",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "Date début YYYY-MM-DD" },
        end: { type: "string", description: "Date fin YYYY-MM-DD" },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "get_forecast_prix",
    description: "Récupère le forecast prix Driscoll's (framboise + myrtille) pour une année. Renvoie le détail semaine par semaine avec min/max/avg en MAD/kg.",
    input_schema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Année (ex: 2026). Optionnel — défaut: année courante." },
        fruitCode: { type: "string", enum: ["RASP", "BLUE", "ALL"], description: "RASP=framboise, BLUE=myrtille, ALL=les deux. Défaut: ALL." },
      },
    },
  },
  {
    name: "get_rendement_equipes_jour",
    description: "Récupère le rendement de récolte par équipe pour une journée : kg total par équipe, nombre d'ouvriers, kg/ouvrier. Les équipes sont identifiées par les 2 premiers caractères du matricule (ex: MM=Boucharen, AY=Chelihat).",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date au format YYYY-MM-DD. Optionnel — défaut: aujourd'hui." },
      },
    },
  },
  {
    name: "get_rendement_equipes_periode",
    description: "Récupère le rendement par équipe agrégé sur une période. Renvoie kg total, nombre de jours actifs et kg/ouvrier-jour par équipe.",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "Date début YYYY-MM-DD" },
        end: { type: "string", description: "Date fin YYYY-MM-DD" },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "get_bdc_en_attente_validation",
    description: "Liste les bons de commande (BdC achats) qui attendent encore une validation : brouillons non soumis, en attente du Chef de Ferme, en attente du DG. Pour chaque BdC renvoie le numéro, le fournisseur, la ferme, le montant TTC, QUI bloque la validation (Achats, Chef F1, Chef F5 ou DG) et depuis combien de jours il attend. Renvoie aussi le nombre total de BdC bloqués, le montant TTC total et la répartition par bloqueur. À utiliser dès qu'on demande ce qui n'est pas validé / en attente / bloqué côté achats ou BdC.",
    input_schema: {
      type: "object",
      properties: {
        ferme: { type: "string", description: "Filtre sur une ferme (ex: F1, F5, Avocatier, BAHIA). Optionnel — défaut: toutes les fermes." },
        limit: { type: "number", description: "Nombre maximum de BdC détaillés à renvoyer, les plus anciens d'abord. Optionnel — défaut: 15." },
      },
    },
  },
];

const { getTeamNameMap } = require("./equipesConfig");
const { PENDING_STATUSES, summarizePendingValidation } = require("./lib/bdc/bdcDigest");
const getTeamMap = () => getTeamNameMap(db);

// ─────────────────────────────────────────────────────────────────────────────
// Tool implementations
// ─────────────────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function tool_get_recolte_du_jour({ date }) {
  const d = date || todayISO();
  const doc = await db.collection("prod_tracabilite_recolte").doc(d).get();
  if (!doc.exists) {
    return { date: d, totalKg: 0, message: "Aucune donnée pour cette date." };
  }
  const data = doc.data() || {};
  const rows = data.rows || [];
  // Aggregate by variety
  const byVariety = {};
  let totalCaisses = 0;
  for (const r of rows) {
    const v = r.variete || "Inconnu";
    byVariety[v] = (byVariety[v] || 0) + (r.totalKg || 0);
    totalCaisses += r.totalCaisses || 0;
  }
  const topVarieties = Object.entries(byVariety)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([variete, kg]) => ({ variete, kg: Math.round(kg) }));
  return {
    date: d,
    totalKg: Math.round(data.totalKg || 0),
    totalCaisses,
    nbTravailleurs: rows.length,
    topVarietes: topVarieties,
    syncedAt: data.syncedAt ? new Date(data.syncedAt._seconds ? data.syncedAt._seconds * 1000 : data.syncedAt).toISOString() : null,
  };
}

async function tool_get_recolte_periode({ start, end }) {
  if (!start || !end) return { error: "start et end requis (YYYY-MM-DD)" };
  // Iterate days and aggregate
  const startD = new Date(start);
  const endD = new Date(end);
  if (isNaN(startD) || isNaN(endD) || startD > endD) {
    return { error: "Dates invalides" };
  }
  const dates = [];
  for (let d = new Date(startD); d <= endD; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  const docs = await Promise.all(
    dates.map(d => db.collection("prod_tracabilite_recolte").doc(d).get())
  );
  let totalKg = 0;
  let activeDays = 0;
  const byVariety = {};
  for (const doc of docs) {
    if (!doc.exists) continue;
    const data = doc.data() || {};
    if ((data.totalKg || 0) > 0) activeDays++;
    totalKg += data.totalKg || 0;
    for (const r of (data.rows || [])) {
      const v = r.variete || "Inconnu";
      byVariety[v] = (byVariety[v] || 0) + (r.totalKg || 0);
    }
  }
  const topVarietes = Object.entries(byVariety)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([variete, kg]) => ({ variete, kg: Math.round(kg) }));
  return {
    start, end,
    totalKg: Math.round(totalKg),
    nbJoursActifs: activeDays,
    nbJoursPeriode: dates.length,
    topVarietes,
  };
}

async function tool_get_forecast_prix({ year, fruitCode }) {
  const yr = parseInt(year) || new Date().getFullYear();
  const codes = (!fruitCode || fruitCode === "ALL") ? ["RASP", "BLUE"] : [fruitCode];
  const result = { year: yr, forecasts: {} };
  for (const code of codes) {
    const fc = await forecastService.getForecast(code, yr);
    if (!fc) {
      result.forecasts[code] = { weeks: {}, message: "Aucun forecast enregistré." };
    } else {
      result.forecasts[code] = { fruit: fc.fruit, weeks: fc.weeks || {}, updatedAt: fc.updatedAt };
    }
  }
  return result;
}

function aggregateRowsByTeam(rows, teamMap) {
  const byTeam = {};
  for (const r of rows || []) {
    const prefix = (r.matricule || "").slice(0, 2).toUpperCase();
    if (!prefix) continue;
    if (!byTeam[prefix]) {
      byTeam[prefix] = { prefix, equipe: teamMap[prefix] || prefix, totalKg: 0, nbOuvriers: 0, totalCaisses: 0 };
    }
    byTeam[prefix].totalKg += r.totalKg || 0;
    byTeam[prefix].nbOuvriers += 1;
    byTeam[prefix].totalCaisses += r.totalCaisses || 0;
  }
  return byTeam;
}

async function tool_get_rendement_equipes_jour({ date }) {
  const d = date || todayISO();
  const [recolteDoc, teamMap] = await Promise.all([
    db.collection("prod_tracabilite_recolte").doc(d).get(),
    getTeamMap(),
  ]);
  if (!recolteDoc.exists) return { date: d, equipes: [], message: "Aucune récolte ce jour." };
  const data = recolteDoc.data() || {};
  const byTeam = aggregateRowsByTeam(data.rows, teamMap);
  const equipes = Object.values(byTeam).map(t => ({
    ...t,
    totalKg: Math.round(t.totalKg),
    rendementKgParOuv: t.nbOuvriers > 0 ? Math.round(t.totalKg / t.nbOuvriers * 10) / 10 : 0,
  })).sort((a, b) => b.rendementKgParOuv - a.rendementKgParOuv);
  return { date: d, totalKg: Math.round(data.totalKg || 0), nbEquipes: equipes.length, equipes };
}

async function tool_get_rendement_equipes_periode({ start, end }) {
  if (!start || !end) return { error: "start et end requis (YYYY-MM-DD)" };
  const startD = new Date(start);
  const endD = new Date(end);
  if (isNaN(startD) || isNaN(endD) || startD > endD) return { error: "Dates invalides" };
  const dates = [];
  for (let d = new Date(startD); d <= endD; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  const [docs, teamMap] = await Promise.all([
    Promise.all(dates.map(d => db.collection("prod_tracabilite_recolte").doc(d).get())),
    getTeamMap(),
  ]);
  // Aggregate kg + ouvrier-jours per team
  const agg = {};
  for (const doc of docs) {
    if (!doc.exists) continue;
    const rows = (doc.data() || {}).rows || [];
    for (const r of rows) {
      const prefix = (r.matricule || "").slice(0, 2).toUpperCase();
      if (!prefix) continue;
      if (!agg[prefix]) {
        agg[prefix] = { prefix, equipe: teamMap[prefix] || prefix, totalKg: 0, ouvrierJours: 0 };
      }
      agg[prefix].totalKg += r.totalKg || 0;
      agg[prefix].ouvrierJours += 1;
    }
  }
  const equipes = Object.values(agg).map(t => ({
    ...t,
    totalKg: Math.round(t.totalKg),
    rendementKgParOuvJour: t.ouvrierJours > 0 ? Math.round(t.totalKg / t.ouvrierJours * 10) / 10 : 0,
  })).sort((a, b) => b.rendementKgParOuvJour - a.rendementKgParOuvJour);
  return { start, end, nbJours: dates.length, equipes };
}

const BDC_QUERY_LIMIT = 200;
const BDC_DEFAULT_ITEMS = 15;

/**
 * BdC en attente de validation. Les totaux (total, totalTtc, byBlocker) sont
 * calculés sur TOUT le jeu de données lu ; seule la liste `items` est bornée
 * à `limit` (le modèle répond en quelques lignes, inutile de lui envoyer 200
 * BdC). `reste` indique combien de BdC ne sont pas détaillés.
 */
async function tool_get_bdc_en_attente_validation({ ferme, limit }) {
  const snap = await db.collection("purchase_orders")
    .where("status", "in", PENDING_STATUSES)
    .limit(BDC_QUERY_LIMIT)
    .get();

  let docs = snap.docs.map(d => d.data() || {});
  const fermeFilter = (ferme || "").trim();
  if (fermeFilter) {
    const norm = fermeFilter.toUpperCase();
    docs = docs.filter(d => String(d.ferme || "").trim().toUpperCase() === norm);
  }

  const summary = summarizePendingValidation(docs, { today: Date.now() });
  const max = Math.max(1, parseInt(limit) || BDC_DEFAULT_ITEMS);
  const items = summary.items.slice(0, max);

  const result = {
    ferme: fermeFilter || "toutes",
    total: summary.total,
    totalTtc: summary.totalTtc,
    byBlocker: summary.byBlocker,
    items,
  };
  if (summary.total > items.length) result.reste = summary.total - items.length;
  // Garde-fou d'honnêteté : au-delà du plafond de lecture, les totaux sont partiels.
  if (snap.size >= BDC_QUERY_LIMIT) result.lectureTronquee = true;
  return result;
}

const TOOL_HANDLERS = {
  get_recolte_du_jour: tool_get_recolte_du_jour,
  get_recolte_periode: tool_get_recolte_periode,
  get_forecast_prix: tool_get_forecast_prix,
  get_rendement_equipes_jour: tool_get_rendement_equipes_jour,
  get_rendement_equipes_periode: tool_get_rendement_equipes_periode,
  get_bdc_en_attente_validation: tool_get_bdc_en_attente_validation,
};

async function executeTool(name, input) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return { error: `Tool inconnu: ${name}` };
  try {
    return await handler(input || {});
  } catch (err) {
    console.error(`Tool ${name} failed:`, err);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agentic loop
// ─────────────────────────────────────────────────────────────────────────────

async function buildSystemPrompt() {
  const today = todayISO();
  let syncInfo = "";
  try {
    const status = await firestoreDataService.getSyncStatus();
    if (status?.dataAge) syncInfo = ` Données dernière sync il y a ${status.dataAge}.`;
  } catch { /* ignore */ }
  return `Tu es l'assistant DG de Berry Good Farms sur WhatsApp.
Aujourd'hui: ${today}.${syncInfo}
Tu as accès aux données récolte et achats (bons de commande) via les tools fournis.
- Utilise un tool dès qu'on te demande des chiffres réels. N'invente jamais.
- Réponds en français concis (max 5 lignes), formaté pour WhatsApp (emojis OK, *gras* avec asterisques). Exception: quand tu listes des BdC, tu peux aller jusqu'à ~10 lignes — ne tronque pas la liste arbitrairement, mentionne plutôt le champ "reste" s'il est présent.
- Si pas de données pour une date, dis-le clairement.
- Pour une période ("semaine", "mois"), calcule toi-même les bornes start/end ISO.

Lexique des statuts BdC (achats):
- brouillon = saisi mais pas encore soumis, la balle est chez les Achats
- en_attente_chef = soumis, attend la validation du Chef de Ferme (Chef F1 pour F1, Chef F5 pour F5)
- en_attente_dg = attend la validation du DG
- valide_dg = validé par le DG (ce n'est plus en attente de validation)

Format de liste BdC pour WhatsApp — un BdC par ligne, du plus ancien au plus récent:
*BDC-2026-0142* — Fournisseur — 12 400 MAD — Chef F1 — 6 j
Termine par une ligne de synthèse (total de BdC bloqués + montant total + qui bloque le plus).`;
}

/**
 * Run an agentic conversation turn.
 * @param {object} args
 * @param {string} args.userText — the user's free-text input
 * @param {Array<{role,content}>} [args.history] — prior conversation turns (text-only)
 * @returns {Promise<{ success: true, reply: string, history: Array } | { success: false, error: string }>}
 */
async function ask({ userText, history = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { success: false, error: "ANTHROPIC_API_KEY manquante" };
  if (!userText?.trim()) return { success: false, error: "Message vide" };

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const system = await buildSystemPrompt();

  // Build messages from history (text-only) + new user turn
  const messages = [];
  for (const h of history) {
    if (h.role && h.content) messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: userText });

  let finalText = null;
  let lastError = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let response = null;
    for (const model of MODEL_CANDIDATES) {
      try {
        response = await client.messages.create({
          model,
          max_tokens: 1500,
          system,
          tools: TOOLS,
          messages,
        });
        break;
      } catch (e) {
        lastError = e;
        console.error(`Agent model ${model} failed:`, e.message);
      }
    }
    if (!response) {
      return { success: false, error: lastError?.message || "Aucun modèle Claude disponible" };
    }

    // Append assistant response to messages for continuity
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      finalText = response.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("\n")
        .trim();
      break;
    }

    // Execute all tool_use blocks
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const result = await executeTool(block.name, block.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!finalText) {
    return { success: false, error: "Boucle agentic épuisée sans réponse texte" };
  }

  // Build updated text-only history (we drop tool_use/tool_result for storage simplicity)
  const newHistory = [
    ...history,
    { role: "user", content: userText },
    { role: "assistant", content: finalText },
  ].slice(-MAX_HISTORY);

  return { success: true, reply: finalText, history: newHistory };
}

module.exports = { ask };
