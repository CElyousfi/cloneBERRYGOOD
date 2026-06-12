'use strict';

// @ts-check

/**
 * Triage IA des bug reports — helpers purs + appel Claude isolé.
 *
 * Les helpers exportés (buildUserContent, buildSystemPrompt, parseTriage) ne
 * font AUCUNE I/O réseau : ils sont testables en isolation (node:test).
 * L'appel réseau réel à l'API Anthropic est isolé dans callClaude(), qui n'est
 * pas couvert par les tests unitaires (mock de `resp` à la place).
 */

// Modules métier reconnus (enum du schéma de sortie).
const MODULES = [
  'pointage',
  'paie',
  'stock',
  'cout_recolte',
  'agronomie',
  'equipes',
  'quinzaine',
  'dashboard',
  'autre',
];

// Sévérités reconnues (enum du schéma de sortie).
const SEVERITIES = ['critical', 'high', 'medium', 'low'];

// Modèle de triage (alias stable côté Anthropic).
const TRIAGE_MODEL = 'claude-sonnet-4-6';

// SYSTEM PROMPT — §4 du spec (texte validé par Omar). NE PAS modifier sans accord.
const SYSTEM_PROMPT = [
  "Tu es l'assistant de triage des bugs de Smart Berry, l'app de gestion de ferme BerryGood.",
  'Tu reçois un signalement de bug (description utilisateur, écran, profil, et éventuellement une capture d\'écran). Tu produis UNIQUEMENT un objet JSON de triage (aucun texte autour).',
  '',
  'Modules de l\'app (choisis le plus précis) :',
  '- pointage : saisie/validation du pointage, présence, heures',
  '- paie : calcul paie, SMAG, primes, déclarés, ancienneté',
  '- stock : magasin, bons de réception/sortie, articles, BDC',
  '- cout_recolte : coût récolte, DH/kg, indicateurs',
  '- agronomie : irrigation, phénologie, stations, parcelles',
  '- equipes : équipes, primes de transport, effectifs',
  '- quinzaine : dashboard quinzaine, trésorerie paie',
  '- dashboard : dashboard général, KPIs globaux',
  '- autre : si rien ne correspond',
  '',
  'Sévérité :',
  '- critical : l\'app crash, données fausses en prod affectant une décision (paie/coût), perte de données, blocage total d\'un workflow métier',
  '- high : fonctionnalité importante cassée mais contournable, chiffre visiblement faux non bloquant',
  '- medium : bug gênant mais sans impact métier majeur (UI, libellé, cas limite)',
  '- low : cosmétique, confort, suggestion',
  '',
  'Détection de doublon : compare au bloc « BUGS RÉCENTS » fourni. isDuplicate=true seulement si c\'est manifestement le même problème (même module + même symptôme). Donne alors duplicateOf = la référence.',
  '',
  'suggestedAction : 1 phrase de piste technique pour l\'architecte (fichier/zone probable, hypothèse de cause). Pas de blabla.',
  'summary : 1 ligne technique factuelle.',
  '',
  'Réponds en français. Sois conservateur sur "critical" (réservé au vrai critique).',
].join('\n');

// Outil de triage — sortie forcée via tool_choice pour garantir un JSON valide.
const TRIAGE_TOOL = {
  name: 'triage_bug',
  description: 'Qualifie un signalement de bug Smart Berry.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      severity: { type: 'string', enum: SEVERITIES },
      module: { type: 'string', enum: MODULES },
      summary: { type: 'string' },
      suggestedAction: { type: 'string' },
      isDuplicate: { type: 'boolean' },
      duplicateOf: { type: ['string', 'null'] },
    },
    required: ['severity', 'module', 'summary', 'suggestedAction', 'isDuplicate', 'duplicateOf'],
  },
};

/**
 * Raccourcit un id Firestore pour l'affichage (réf courte #abcd1234).
 * @param {any} id
 * @returns {string}
 */
function shortId(id) {
  if (typeof id !== 'string' || !id) return '?';
  return id.slice(0, 8);
}

/**
 * Détecte la TRANSITION d'un bug report vers le statut 'resolved'.
 * Idempotent : ne déclenche que sur le passage `!== resolved -> resolved`.
 * - Pas de re-notif si le doc était déjà 'resolved'.
 * - Pas de notif sur les autres updates (ex. triage qui pose 'qualified').
 * @param {{status?: string}} before
 * @param {{status?: string}} after
 * @returns {boolean}
 */
function shouldNotifyResolved(before, after) {
  const b = (before && before.status) || null;
  const a = (after && after.status) || null;
  if (a !== 'resolved') return false;
  if (b === 'resolved') return false;
  return true;
}

/**
 * Construit le message de notification envoyé au reporter quand son
 * signalement est corrigé. Format identique WhatsApp / in-app.
 * @param {{summary?: string, description?: string}} after
 * @param {string} idCourt - réf courte (shortId)
 * @returns {string}
 */
function buildResolvedMessage(after, idCourt) {
  const detail = (after && (after.summary || after.description)) || '';
  return '✅ Votre signalement #' + idCourt + ' a été corrigé et déployé.\n'
    + detail + '. Merci pour votre retour !';
}

/**
 * Construit le bloc « BUGS RÉCENTS » injecté dans le system prompt.
 * @param {Array<{id?: string, module?: string, summary?: string}>} recentBugs
 * @returns {string}
 */
function buildRecentBugsBlock(recentBugs) {
  const lines = ['BUGS RÉCENTS (pour détection de doublon) :'];
  if (!Array.isArray(recentBugs) || recentBugs.length === 0) {
    lines.push('- (aucun)');
    return lines.join('\n');
  }
  recentBugs.slice(0, 20).forEach((b) => {
    const mod = (b && b.module) || 'autre';
    const sum = (b && b.summary) || '(sans résumé)';
    lines.push('- #' + shortId(b && b.id) + ' [' + mod + '] ' + sum);
  });
  return lines.join('\n');
}

/**
 * Construit le system prompt complet (prompt fixe + bloc bugs récents).
 * @param {Array<Object>} recentBugs
 * @returns {string}
 */
function buildSystemPrompt(recentBugs) {
  return SYSTEM_PROMPT + '\n\n' + buildRecentBugsBlock(recentBugs);
}

/**
 * Construit le bloc texte décrivant le signalement (champs utilisateur).
 * @param {Object} doc — données du doc bug_reports.
 * @returns {string}
 */
function buildTextBlock(doc) {
  const d = doc || {};
  const reporter = d.reporter || {};
  const device = d.device || {};
  const profil = reporter.profileId || '(inconnu)';
  const ua = device.userAgent || '(inconnu)';
  return [
    'SIGNALEMENT DE BUG',
    'Description : ' + (d.description || '(vide)'),
    'Écran : ' + (d.screen || '(inconnu)'),
    'Profil du rapporteur : ' + profil,
    'User-Agent : ' + ua,
  ].join('\n');
}

/**
 * Construit le contenu du message `user` pour Claude.
 * - Si un screenshot est présent (photo_url ou photoBase64) → bloc image + texte.
 * - Sinon → bloc texte seul.
 *
 * Le screenshot in-app est stocké en URL Storage publique (champ `photo_url`).
 * On privilégie une source `url` (l'API Anthropic la télécharge) ; un base64
 * inline (`photoBase64`/`screenshotBase64`) reste supporté en fallback.
 *
 * @param {Object} doc
 * @returns {Array<Object>}
 */
function buildUserContent(doc) {
  const d = doc || {};
  const textBlock = { type: 'text', text: buildTextBlock(d) };

  const base64 = d.photoBase64 || d.screenshotBase64 || null;
  if (base64) {
    const raw = String(base64).replace(/^data:image\/\w+;base64,/, '');
    return [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: raw } },
      textBlock,
    ];
  }

  const url = d.photo_url || d.screenshot || null;
  if (url && typeof url === 'string') {
    return [
      { type: 'image', source: { type: 'url', url: url } },
      textBlock,
    ];
  }

  return [textBlock];
}

/**
 * Indique si un objet est un résultat de triage structurellement valide.
 * @param {any} t
 * @returns {boolean}
 */
function isValidTriage(t) {
  if (!t || typeof t !== 'object') return false;
  if (SEVERITIES.indexOf(t.severity) < 0) return false;
  if (MODULES.indexOf(t.module) < 0) return false;
  if (typeof t.summary !== 'string' || !t.summary) return false;
  if (typeof t.suggestedAction !== 'string') return false;
  if (typeof t.isDuplicate !== 'boolean') return false;
  if (t.duplicateOf !== null && typeof t.duplicateOf !== 'string') return false;
  return true;
}

/**
 * Extrait et valide le triage depuis la réponse Claude (tool_use).
 * @param {Object} resp — réponse `messages.create`.
 * @returns {Object|null} l'objet triage validé, ou null si invalide/absent.
 */
function parseTriage(resp) {
  if (!resp || !Array.isArray(resp.content)) return null;
  const block = resp.content.find((b) => b && b.type === 'tool_use');
  if (!block) return null;
  const triage = block.input || null;
  if (!isValidTriage(triage)) return null;
  // Cohérence : pas de duplicateOf si non-doublon.
  return {
    severity: triage.severity,
    module: triage.module,
    summary: triage.summary,
    suggestedAction: triage.suggestedAction,
    isDuplicate: triage.isDuplicate,
    duplicateOf: triage.isDuplicate ? (triage.duplicateOf || null) : null,
  };
}

/**
 * Appel réseau réel à l'API Anthropic (NON testé en unit — mock `resp`).
 * @param {Object} client — instance Anthropic.
 * @param {{system: string, userContent: Array<Object>}} args
 * @returns {Promise<Object>} la réponse brute `messages.create`.
 */
async function callClaude(client, args) {
  return client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 500,
    temperature: 0,
    system: args.system,
    tools: [TRIAGE_TOOL],
    tool_choice: { type: 'tool', name: 'triage_bug' },
    messages: [{ role: 'user', content: args.userContent }],
  });
}

module.exports = {
  MODULES,
  SEVERITIES,
  TRIAGE_MODEL,
  SYSTEM_PROMPT,
  TRIAGE_TOOL,
  shortId,
  shouldNotifyResolved,
  buildResolvedMessage,
  buildRecentBugsBlock,
  buildSystemPrompt,
  buildTextBlock,
  buildUserContent,
  isValidTriage,
  parseTriage,
  callClaude,
}
