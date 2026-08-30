'use strict';
// @ts-check

/**
 * Transparence de déploiement — fonctions PURES.
 *
 * Objectif : avant tout déploiement, savoir (a) ce qui est déjà en prod et
 * (b) ce que la commande s'apprête à y ajouter. Aucune I/O ici : la collecte
 * (gh, git, API Hosting) vit dans scripts/deploy-context.js, qui appelle ces
 * fonctions. Ce découpage permet de tester le calcul de l'écart et son
 * formatage sans réseau.
 *
 * Règle d'or : ce module ne throw JAMAIS sur des données malformées — il
 * dégrade en « information indisponible ». Le deploy ne doit pas échouer à
 * cause d'un affichage.
 */

/**
 * @typedef {Object} GhRun
 * @property {number} [databaseId]
 * @property {string} [status]
 * @property {string} [conclusion]
 * @property {string} [headSha]
 * @property {string} [createdAt]
 * @property {string} [displayTitle]
 */

/**
 * @typedef {Object} LastDeploy
 * @property {string} sha            SHA complet (ou court si c'est tout ce qu'on a)
 * @property {string} shortSha
 * @property {string|null} subject   Sujet du commit déployé, si connu
 * @property {string|null} at        Date ISO du déploiement
 * @property {string} source         'gh-run' | 'hosting-release'
 */

/**
 * @typedef {Object} CommitEntry
 * @property {string} shortSha
 * @property {string} subject
 * @property {string|null} originLabel  Branche/PR d'origine si déterminable
 * @property {boolean} foreign          true = provient d'une autre branche que la courante
 */

/**
 * Nom de run produit par `run-name:` dans .github/workflows/deploy-prod.yml.
 * Format figé, volontairement re-parsable :
 *   « Deploy prod functions (dry_run=false, only=functions) »
 *
 * POURQUOI CE PARSING EXISTE
 * --------------------------
 * `gh run list --json` n'expose PAS les `inputs` d'un `workflow_dispatch`. Or un
 * run `dry_run=true` (le DÉFAUT du workflow) réussit intégralement SANS rien
 * déployer, et un run `only=functions:uneSeuleFonction` ne déploie qu'une
 * function. Les deux sont indistinguables d'un vrai deploy complet sur
 * `conclusion`/`status`/`headSha`/`displayTitle` statique. Le `run-name` est le
 * seul endroit où ces inputs redeviennent lisibles depuis l'API.
 *
 * Regex ANCRÉE : `only` est une chaîne libre côté dispatch, et le run-name est
 * évalué avant le garde-fou de cible du workflow. Un `only` contenant « ) » ne
 * doit pas pouvoir fabriquer un nom qui parse.
 *
 * @param {string|null|undefined} displayTitle
 * @returns {{dryRun: boolean, only: string}|null} null si le titre ne porte pas
 *   l'information (runs antérieurs à cette convention, ou titre inattendu).
 */
function parseDeployRunName(displayTitle) {
  if (!displayTitle || typeof displayTitle !== 'string') return null;
  const m = /^Deploy prod functions \(dry_run=(true|false), only=([^()]*)\)$/.exec(
    displayTitle.trim()
  );
  if (!m) return null;
  return { dryRun: m[1] === 'true', only: m[2] };
}

/**
 * Un run prouve-t-il que TOUT `functions/` est déployé au commit du run ?
 *
 * Fail-closed : un titre non parsable rend `false`. Un run antérieur à la
 * convention `run-name` ne prouve rien — on préfère « information
 * indisponible » à un faux vert.
 *
 * @param {GhRun|unknown} run
 * @returns {boolean}
 */
function isRealFullFunctionsDeploy(run) {
  if (!run || typeof run !== 'object') return false;
  const parsed = parseDeployRunName(/** @type {GhRun} */ (run).displayTitle);
  if (!parsed) return false;
  if (parsed.dryRun) return false;
  // `functions:uneSeuleFonction` déploie UNE function : ne pas le créditer comme
  // « tout functions/ est à ce commit ».
  return parsed.only === 'functions';
}

/**
 * Sélectionne le dernier run de déploiement RÉUSSI, hors runs exclus.
 *
 * Un run en cours (`status !== 'completed'`) n'est jamais retenu : il ne prouve
 * rien sur ce qui est live. `excludeRunIds` sert à écarter le run qu'on vient
 * de déclencher, si l'appelant en connaît l'id.
 *
 * `realDeployOnly` (défaut FALSE, pour ne rien changer à l'affichage de
 * scripts/deploy.sh) restreint aux runs qui ont réellement déployé tout
 * `functions/` — cf. isRealFullFunctionsDeploy. À n'activer que quand la
 * réponse sert de GARDE-FOU (scripts/preview.sh --post-merge), pas d'affichage.
 *
 * @param {GhRun[]|unknown} runs
 * @param {{excludeRunIds?: Array<number|string>, realDeployOnly?: boolean}} [options]
 * @returns {GhRun|null}
 */
function selectLastSuccessfulRun(runs, options) {
  if (!Array.isArray(runs)) return null;
  const excluded = new Set(
    ((options && options.excludeRunIds) || []).map(function (id) {
      return String(id);
    })
  );
  const realDeployOnly = Boolean(options && options.realDeployOnly);
  const eligible = runs.filter(function (run) {
    if (!run || typeof run !== 'object') return false;
    if (run.conclusion !== 'success') return false;
    if (run.status !== 'completed') return false;
    if (!run.headSha) return false;
    if (excluded.has(String(run.databaseId))) return false;
    if (realDeployOnly && !isRealFullFunctionsDeploy(run)) return false;
    return true;
  });
  if (eligible.length === 0) return null;
  // `gh run list` rend déjà le plus récent en premier, mais on ne s'y fie pas :
  // un tri explicite sur createdAt évite un faux « dernier déploiement » si
  // l'ordre change (option --json, pagination…).
  const sorted = eligible.slice().sort(function (a, b) {
    const ta = Date.parse(a.createdAt || '') || 0;
    const tb = Date.parse(b.createdAt || '') || 0;
    return tb - ta;
  });
  return sorted[0];
}

/**
 * Raccourcit un SHA à 7 caractères (comme `git rev-parse --short`).
 * @param {string|null|undefined} sha
 * @returns {string}
 */
function shortenSha(sha) {
  if (!sha || typeof sha !== 'string') return '';
  return sha.trim().slice(0, 7);
}

/**
 * Construit le message de release Hosting passé à `firebase deploy -m`.
 * Format volontairement simple et re-parsable : « <sha> <sujet> ».
 * @param {string} sha
 * @param {string} [subject]
 * @returns {string}
 */
function buildHostingReleaseMessage(sha, subject) {
  const s = shortenSha(sha);
  const subj = (subject || '').replace(/\s+/g, ' ').trim();
  if (!s) return subj;
  return subj ? s + ' ' + subj : s;
}

/**
 * Parse le message de release Hosting écrit par buildHostingReleaseMessage.
 * Tolérant : un message d'une autre origine (deploy manuel, console Firebase)
 * ne doit pas produire un faux SHA.
 * @param {string|null|undefined} message
 * @returns {{sha: string, subject: string|null}|null}
 */
function parseHostingReleaseMessage(message) {
  if (!message || typeof message !== 'string') return null;
  const m = message.trim().match(/^([0-9a-f]{7,40})(?:\s+(.*))?$/i);
  if (!m) return null;
  const subject = m[2] ? m[2].trim() : '';
  return { sha: m[1].toLowerCase(), subject: subject || null };
}

/**
 * Déduit la branche (ou la PR) d'origine d'un commit à partir de son sujet.
 *
 * Trois formes rencontrées sur ce dépôt :
 *   - merge commit GitHub  : « Merge pull request #320 from ORG/sb/foo »
 *   - merge local          : « Merge branch 'sb/foo' into main »
 *   - squash-merge         : « feat(x): … (#320) » → branche perdue, PR connue
 * @param {string|null|undefined} subject
 * @returns {string|null} label lisible, ou null si indéterminable
 */
function extractOriginLabel(subject) {
  if (!subject || typeof subject !== 'string') return null;
  const pr = subject.match(/^Merge pull request #(\d+) from (?:[^/\s]+\/)?(\S+)/);
  if (pr) return pr[2] + ' (PR #' + pr[1] + ')';
  const merge = subject.match(/^Merge branch '([^']+)'/);
  if (merge) return merge[1];
  const squash = subject.match(/\(#(\d+)\)\s*$/);
  if (squash) return 'PR #' + squash[1];
  return null;
}

/**
 * Construit l'écart entre le dernier déploiement et HEAD.
 *
 * @param {Object} input
 * @param {LastDeploy|null} input.lastDeploy
 * @param {Array<{shortSha: string, subject: string}>|null} input.commits
 *        Commits de `lastDeploy.sha..HEAD`, du plus ancien au plus récent.
 *        `null` = impossible à calculer (sha inconnu localement, git en échec).
 * @param {string} input.currentBranch
 * @param {string|null} [input.unavailableReason]
 * @returns {{status: 'unavailable'|'empty'|'ahead', entries: CommitEntry[], foreignCount: number, reason: string|null}}
 */
function buildDelta(input) {
  const currentBranch = (input && input.currentBranch) || '';
  const reason = (input && input.unavailableReason) || null;
  if (!input || !input.lastDeploy || !Array.isArray(input.commits)) {
    return {
      status: 'unavailable',
      entries: [],
      foreignCount: 0,
      reason: reason || 'historique introuvable',
    };
  }
  const entries = input.commits.map(function (c) {
    const originLabel = extractOriginLabel(c.subject);
    // « foreign » = origine CONNUE et différente de la branche courante. Une
    // origine inconnue n'est pas signalée : on informe, on ne crie pas au loup.
    const foreign = originLabel !== null && originLabel.split(' ')[0] !== currentBranch;
    return {
      shortSha: c.shortSha,
      subject: c.subject,
      originLabel: originLabel,
      foreign: foreign,
    };
  });
  const foreignCount = entries.filter(function (e) {
    return e.foreign;
  }).length;
  return {
    status: entries.length === 0 ? 'empty' : 'ahead',
    entries: entries,
    foreignCount: foreignCount,
    reason: null,
  };
}

/**
 * Formate un instant ISO en « AAAA-MM-JJ HH:MM UTC ».
 * @param {string|null|undefined} iso
 * @returns {string}
 */
function formatInstant(iso) {
  if (!iso) return 'date inconnue';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'date inconnue';
  const d = new Date(t);
  const pad = function (n) {
    return String(n).padStart(2, '0');
  };
  return (
    d.getUTCFullYear() +
    '-' + pad(d.getUTCMonth() + 1) +
    '-' + pad(d.getUTCDate()) +
    ' ' + pad(d.getUTCHours()) +
    ':' + pad(d.getUTCMinutes()) +
    ' UTC'
  );
}

/**
 * Rend le bloc « dernier déploiement / écart » affiché avant tout deploy.
 *
 * @param {Object} input
 * @param {string} input.target                 'functions' | 'hosting'
 * @param {LastDeploy|null} input.lastDeploy
 * @param {ReturnType<typeof buildDelta>} input.delta
 * @param {string} input.headShortSha
 * @param {string} input.currentBranch
 * @returns {string[]} lignes à afficher (sans préfixe)
 */
function formatDeployBlock(input) {
  const lines = [];
  const target = (input && input.target) || '?';
  const lastDeploy = (input && input.lastDeploy) || null;
  const delta = (input && input.delta) || {
    status: 'unavailable',
    entries: [],
    foreignCount: 0,
    reason: null,
  };

  lines.push('── Transparence : ce que ce deploy embarque ──');

  if (lastDeploy) {
    const subj = lastDeploy.subject ? ' « ' + lastDeploy.subject + ' »' : '';
    lines.push(
      'Dernier déploiement ' + target + ' : ' + lastDeploy.shortSha + subj +
      ' (' + formatInstant(lastDeploy.at) + ')'
    );
  } else {
    lines.push(
      'Dernier déploiement ' + target + ' : information indisponible' +
      (delta.reason ? ' (' + delta.reason + ')' : '') + ' — affichage seul, le deploy continue.'
    );
  }

  if (delta.status === 'unavailable') {
    lines.push('Écart avec HEAD (' + (input.headShortSha || '?') + ') : information indisponible.');
    return lines;
  }
  if (delta.status === 'empty') {
    lines.push(
      'Écart avec HEAD (' + (input.headShortSha || '?') + ') : ' +
      'rien de nouveau depuis le dernier déploiement.'
    );
    return lines;
  }

  lines.push(
    'Écart avec HEAD (' + (input.headShortSha || '?') + ') : ' +
    delta.entries.length + ' commit(s) non déployé(s), du plus ancien au plus récent :'
  );
  delta.entries.forEach(function (e) {
    const marker = e.foreign ? '  ⚠ ' : '    ';
    const origin = e.originLabel ? '   [' + e.originLabel + ']' : '';
    lines.push(marker + e.shortSha + '  ' + e.subject + origin);
  });
  if (delta.foreignCount > 0) {
    lines.push(
      '⚠ ' + delta.foreignCount + ' commit(s) proviennent d\'une autre branche que \'' +
      (input.currentBranch || '?') + '\' — vérifier qu\'aucun travail non validé ne part en prod.'
    );
  }
  return lines;
}

module.exports = {
  selectLastSuccessfulRun,
  parseDeployRunName,
  isRealFullFunctionsDeploy,
  shortenSha,
  buildHostingReleaseMessage,
  parseHostingReleaseMessage,
  extractOriginLabel,
  buildDelta,
  formatInstant,
  formatDeployBlock,
}
