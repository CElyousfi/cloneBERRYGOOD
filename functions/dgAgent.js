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
  {
    name: "get_bdc_non_receptionnes",
    description: "Liste les bons de commande (BdC achats) validés/envoyés qui n'ont PAS encore été entièrement réceptionnés au magasin : rien de livré (non_livre) ou livré partiellement (partiel). L'état est recalculé à partir des bons de livraison (BL) réellement enregistrés, pas du statut du BdC. Pour chaque BdC renvoie le numéro, le fournisseur, la ferme, le montant TTC, l'état de livraison, la date de livraison prévue, le retard en jours, le pourcentage déjà reçu et le nombre d'articles encore incomplets (reliquat). Renvoie aussi le nombre total de BdC en attente de réception, le montant TTC total, le nombre en retard et la répartition par état. À utiliser dès qu'on demande ce qui n'est pas réceptionné / pas livré / en attente de livraison / en retard de livraison côté magasin ou achats.",
    input_schema: {
      type: "object",
      properties: {
        ferme: { type: "string", description: "Filtre sur une ferme (ex: F1, F5, Avocatier, BAHIA). Optionnel — défaut: toutes les fermes." },
        enRetardSeulement: { type: "boolean", description: "true = ne garder que les BdC dont la date de livraison prévue est dépassée. Optionnel — défaut: false." },
        limit: { type: "number", description: "Nombre maximum de BdC détaillés à renvoyer, les plus en retard d'abord. Optionnel — défaut: 15." },
      },
    },
  },
  {
    name: "get_bdc_detail",
    description: "Détail article par article d'UN bon de commande identifié par son numéro (ex: BDC-2026-0142) : pour chaque article la quantité commandée, la quantité déjà livrée via les BL, et le reliquat restant à recevoir. Renvoie aussi l'entête du BdC (fournisseur, ferme, montant TTC, statut, état de livraison recalculé, date de livraison prévue, retard). À utiliser quand on demande le détail / les articles / le reliquat d'un BdC précis.",
    input_schema: {
      type: "object",
      properties: {
        numero: { type: "string", description: "Numéro du BdC, ex: BDC-2026-0142." },
      },
      required: ["numero"],
    },
  },
];

const { getTeamNameMap } = require("./equipesConfig");
const {
  PENDING_STATUSES,
  RECEIVABLE_STATUSES,
  summarizePendingValidation,
  buildDigestPayload,
  summarizePendingReception,
  detailArticles,
  buildReceptionPayload,
} = require("./lib/bdc/bdcDigest");
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

// Plafond de lecture. 500 rend la troncature quasi impossible en pratique et
// couvre le sous-comptage du filtre `ferme`, appliqué après le plafond.
const BDC_QUERY_LIMIT = 500;

/**
 * BdC en attente de validation. Ce handler ne fait que la lecture Firestore ;
 * toute la mise en forme (bornage, reste, troncature) est dans le module pur
 * testé functions/lib/bdc/bdcDigest.js.
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
  return buildDigestPayload(summary, limit, { ferme: fermeFilter, tronque: snap.size >= BDC_QUERY_LIMIT });
}

// Nombre de BdC dont on charge les BL en parallèle. Évite d'ouvrir une rafale
// de centaines de requêtes Firestore d'un coup, sans borner le jeu agrégé.
const BL_FETCH_CONCURRENCY = 25;

/**
 * BL vivants d'un BdC. Le filtre `!bl.deleted` est le même que celui de
 * l'action `list-bl` (functions/index.js) : un BL soft-deleted ne compte NULLE
 * PART dans le reliquat, sinon il masquerait un BdC non réceptionné.
 */
async function loadLiveBls(bdcId) {
  const snap = await db.collection("delivery_notes").where("bdc_id", "==", bdcId).get();
  return snap.docs.map(d => d.data() || {}).filter(bl => !bl.deleted);
}

/** Table { bdcId: BL[] } pour une liste de BdC, par vagues de concurrence bornée. */
async function loadBlsByBdcId(docs) {
  const table = {};
  for (let i = 0; i < docs.length; i += BL_FETCH_CONCURRENCY) {
    const chunk = docs.slice(i, i + BL_FETCH_CONCURRENCY);
    const bls = await Promise.all(chunk.map(d => loadLiveBls(d.id)));
    chunk.forEach((d, k) => { table[d.id] = bls[k]; });
  }
  return table;
}

/**
 * BdC pas encore entièrement réceptionnés. Même périmètre que l'onglet
 * magasin « Réception » (public/components/MagBdcReceptionTab.jsx) : statuts
 * RECEIVABLE_STATUSES, BdC soldés exclus. Différence assumée : l'état de
 * livraison est RECALCULÉ à partir des BL vivants au lieu d'être lu sur le
 * champ matérialisé `delivery_status`.
 */
async function tool_get_bdc_non_receptionnes({ ferme, enRetardSeulement, limit }) {
  const snap = await db.collection("purchase_orders")
    .where("status", "in", RECEIVABLE_STATUSES)
    .limit(BDC_QUERY_LIMIT)
    .get();

  let docs = snap.docs.map(d => Object.assign({ id: d.id }, d.data() || {}));
  const fermeFilter = (ferme || "").trim();
  if (fermeFilter) {
    const norm = fermeFilter.toUpperCase();
    docs = docs.filter(d => String(d.ferme || "").trim().toUpperCase() === norm);
  }
  // Les BdC déjà marqués soldés sont écartés AVANT de charger leurs BL : ça
  // évite N lectures inutiles. Pour tous les autres, c'est le recalcul sur les
  // BL qui fait foi (un `delivery_status` "complet" erroné resterait invisible,
  // mais l'onglet magasin les masque déjà de la même façon).
  docs = docs.filter(d => d.delivery_status !== "complet");

  const blsByBdcId = await loadBlsByBdcId(docs);
  const summary = summarizePendingReception(docs, blsByBdcId, {
    today: Date.now(),
    enRetardSeulement: enRetardSeulement === true,
  });
  return buildReceptionPayload(summary, limit, {
    ferme: fermeFilter,
    tronque: snap.size >= BDC_QUERY_LIMIT,
    enRetardSeulement: enRetardSeulement === true,
  });
}

/** Détail article par article d'un BdC désigné par son numéro. */
async function tool_get_bdc_detail({ numero }) {
  const num = (numero || "").trim();
  if (!num) return { error: "numero requis (ex: BDC-2026-0142)" };

  const snap = await db.collection("purchase_orders").where("numero", "==", num).limit(1).get();
  if (snap.empty) return { numero: num, error: "Aucun BdC avec ce numéro." };

  const doc = snap.docs[0];
  const bdc = Object.assign({ id: doc.id }, doc.data() || {});
  const bls = await loadLiveBls(doc.id);

  // Réutilise le module pur pour l'entête (état recalculé, retard, % reçu).
  // Résumé vide = BdC soldé ou statut non réceptionnable : on le dit au lieu
  // de renvoyer une entête muette.
  const resume = summarizePendingReception([bdc], { [bdc.id]: bls }, { today: Date.now() });
  const receptionnable = RECEIVABLE_STATUSES.includes(bdc.status);
  const entete = resume.items[0] || {
    numero: bdc.numero || num,
    fournisseur: (bdc.fournisseur && bdc.fournisseur.nom) || bdc.fournisseur || "—",
    ferme: bdc.ferme || null,
    totalTtc: parseFloat(bdc.total_ttc) || 0,
    // Statut hors périmètre réception (brouillon, en attente de validation…) :
    // ne pas prétendre à un "complet" qui n'a pas de sens.
    deliveryStatus: receptionnable ? "complet" : "non_receptionnable",
    dateLivraisonPrevue: bdc.date_livraison_prevue || null,
    retardJours: null,
    pctRecu: receptionnable ? 100 : null,
    nbArticlesIncomplets: 0,
  };

  return Object.assign({ status: bdc.status || "", nbBl: bls.length, articles: detailArticles(bdc, bls) }, entete);
}

const TOOL_HANDLERS = {
  get_recolte_du_jour: tool_get_recolte_du_jour,
  get_recolte_periode: tool_get_recolte_periode,
  get_forecast_prix: tool_get_forecast_prix,
  get_rendement_equipes_jour: tool_get_rendement_equipes_jour,
  get_rendement_equipes_periode: tool_get_rendement_equipes_periode,
  get_bdc_en_attente_validation: tool_get_bdc_en_attente_validation,
  get_bdc_non_receptionnes: tool_get_bdc_non_receptionnes,
  get_bdc_detail: tool_get_bdc_detail,
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
- bloqueur "aucun_valideur" = aucun chef de ferme n'est compétent pour cette ferme (souvent une ferme mal saisie) : personne ne peut valider, il faut corriger le BdC. Ne l'attribue jamais au DG.
- BdC sans date exploitable: "ageJours" vaut null → dis "date inconnue", n'affiche pas "0 j".
- Si le champ "lectureTronquee" est présent, les totaux sont PARTIELS (plafond de lecture atteint): précise-le au lieu de les présenter comme exacts.

Format de liste BdC pour WhatsApp — un BdC par ligne, du plus ancien au plus récent:
*BDC-2026-0142* — Fournisseur — 12 400 MAD — Chef F1 — 6 j
Termine par une ligne de synthèse (total de BdC bloqués + montant total + qui bloque le plus).

Réception (livraison physique au magasin):
- Un BdC validé n'est pas pour autant reçu : "réceptionné" se juge sur les bons de livraison (BL) enregistrés, JAMAIS sur le statut du BdC.
- Reliquat = quantité commandée − quantité déjà reçue, article par article. Tant qu'un article a du reliquat, le BdC n'est pas soldé.
- deliveryStatus: non_livre = aucun BL, partiel = au moins un BL mais du reliquat restant. Les BdC complets ne sont jamais listés.
- "retardJours" null = pas de date de livraison prévue → dis "échéance non renseignée", n'invente pas de retard. 0 = pas encore échu.

Format de liste réception pour WhatsApp — un BdC par ligne, le plus en retard d'abord:
*BDC-2026-0142* — Fournisseur — 40 % reçu — 6 j de retard
Termine par une ligne de synthèse (nombre de BdC non réceptionnés + combien en retard + montant total).`;
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

// TOOL_HANDLERS est exposé pour permettre de rejouer un tool avec Firestore
// stubbé (smoke de parité avec l'onglet magasin) sans passer par l'API Claude.
// Gelé : c'est une référence vivante, un consommateur ne doit pas pouvoir
// remplacer un handler du registre utilisé par la boucle agentic.
module.exports = { ask, TOOL_HANDLERS: Object.freeze(TOOL_HANDLERS) };
