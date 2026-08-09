'use strict';
// @ts-check

/**
 * generate-code-index.js — Génère la carte de localisation du code Smart Berry.
 *
 * Quatre sorties versionnées :
 *   - docs/ai/code-map-actions.md    : actions backend `action === "…"` → fichier:ligne + handler
 *   - docs/ai/code-map-components.md : composants React → fichier:ligne + tab
 *   - docs/ai/code-map-modules.md    : modules public/lib + functions/lib → export global + fonctions
 *   - docs/ai/require-index.json     : fichier cible → tests directs ET transitifs
 *
 * Objectif : donner à un agent l'emplacement direct d'un symbole dans les
 * monolithes (functions/index.js ~17k lignes, public/app.jsx ~69k lignes) sans
 * avoir à les charger en contexte.
 *
 * LIMITES (assumées) :
 *   - Le parsing est purement textuel (regex), pas d'AST. Les formes exotiques
 *     (switch/case, action calculée, destructuration) ne sont pas détectées.
 *   - La découverte des fichiers d'actions est dynamique (git ls-files +
 *     présence de `action ===`) : un fichier non tracké par git est ignoré.
 *   - Le require-index ne suit que les require() RELATIFS (pas les alias, pas
 *     les imports ESM).
 *
 * Usage :
 *   node scripts/generate-code-index.js
 *   node scripts/generate-code-index.js --fingerprint-only=actions
 *   node scripts/generate-code-index.js --fingerprint-only=components
 *   node scripts/generate-code-index.js --fingerprint-only=modules
 *   node scripts/generate-code-index.js --fingerprint-only=require-index
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { computeFingerprint, sortKeysDeep } = require('./generate-module-graph.js');

const SCHEMA_VERSION = 1;
const GENERATOR_VERSION = '1.0.0';

/** Arbres cibles du require-index. @type {string[]} */
const TARGET_TREES = [
  'functions/lib',
  'functions/middleware',
  'public/lib',
  'public/components',
];

/** Extensions retenues dans les arbres cibles. */
const TARGET_EXTENSIONS = ['.js', '.jsx'];

/**
 * Regex d'extraction d'une action HTTP.
 * Volontairement NON ancrée sur `if|else if` : les actions déclarées en
 * disjonction (`if (action === "a" || action === "b")`) doivent toutes être
 * capturées. Le lookbehind `(?<![.\w])` écarte les accès de propriété
 * (`p.action === …`, `res.action === …`) qui ne sont pas des actions HTTP.
 * Les commentaires sont neutralisés en amont par `maskCommentsAndStrings`.
 */
const ACTION_PATTERN =
  /(?<![.\w])action\s*===\s*["']([\w-]+)["']\s*(?:&&\s*req\.method\s*===\s*["'](\w+)["'])?/g;

// ---------------------------------------------------------------------------
// Helpers filesystem
// ---------------------------------------------------------------------------

/**
 * Lit un fichier en toute sécurité — retourne null si absent/illisible.
 * @param {string} filePath
 * @returns {string|null}
 */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Parcourt récursivement un répertoire et retourne les chemins relatifs (POSIX)
 * des fichiers correspondant au filtre.
 * @param {string} root racine du repo
 * @param {string} relDir répertoire relatif à scanner
 * @param {(relPath: string) => boolean} accept
 * @returns {string[]} triés
 */
function walkFiles(root, relDir, accept) {
  const abs = path.join(root, relDir);
  if (!fs.existsSync(abs)) return [];
  /** @type {string[]} */
  const out = [];
  /** @param {string} currentRel */
  function rec(currentRel) {
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, currentRel), { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      const childRel = currentRel + '/' + entry.name;
      if (entry.isDirectory()) {
        rec(childRel);
      } else if (entry.isFile() && accept(childRel)) {
        out.push(childRel);
      }
    }
  }
  rec(relDir);
  return out.sort();
}

/**
 * True si le chemin traverse un répertoire __tests__.
 * @param {string} relPath
 * @returns {boolean}
 */
function isInTests(relPath) {
  return relPath.split('/').includes('__tests__');
}

/**
 * Énumère les fichiers trackés par git sous un préfixe.
 * Déterministe (exclut les fichiers gitignorés / artefacts filesystem).
 * Fallback filesystem si git est indisponible.
 * @param {string} root
 * @param {string} prefix ex. 'functions/'
 * @returns {string[]} chemins relatifs POSIX triés
 */
function gitListFiles(root, prefix) {
  try {
    return execSync(`git -C "${root}" ls-files ${prefix}`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .sort();
  } catch (e) {
    const rel = prefix.replace(/\/$/, '');
    return walkFiles(root, rel, () => true);
  }
}

// ---------------------------------------------------------------------------
// Section A — Actions backend
// ---------------------------------------------------------------------------

/**
 * Neutralise les COMMENTAIRES (`//…` et `/*…*\/`) en remplaçant leurs
 * caractères par des espaces, SANS changer la longueur ni les retours à la
 * ligne : les index (donc les numéros de ligne) du texte masqué restent ceux
 * du texte d'origine.
 *
 * Objectif : ne jamais extraire une action depuis un commentaire de code mort
 * (ex. `// action === "update-bug-status"` dans functions/index.js).
 *
 * Les littéraux de chaîne sont SUIVIS mais PAS masqués — le nom de l'action
 * est lui-même une chaîne. Les suivre évite de prendre le `//` de
 * `'https://…'` pour un début de commentaire.
 * @param {string} content
 * @returns {string} même longueur que `content`
 */
function maskComments(content) {
  const out = content.split('');
  const n = content.length;
  let i = 0;
  /** @type {null|'"'|"'"|'`'} */
  let stringMode = null;

  /** @param {number} idx */
  const blank = idx => {
    if (idx < n && out[idx] !== '\n') out[idx] = ' ';
  };

  while (i < n) {
    const c = content[i];
    const next = content[i + 1];

    if (stringMode !== null) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === stringMode || c === '\n') stringMode = null;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      stringMode = /** @type {any} */ (c);
      i += 1;
      continue;
    }

    if (c === '/' && next === '/') {
      while (i < n && content[i] !== '\n') {
        blank(i);
        i += 1;
      }
      continue;
    }

    if (c === '/' && next === '*') {
      blank(i);
      blank(i + 1);
      i += 2;
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) {
        blank(i);
        i += 1;
      }
      blank(i);
      blank(i + 1);
      i += 2;
      continue;
    }

    i += 1;
  }

  return out.join('');
}

/**
 * Découverte DYNAMIQUE des fichiers backend exposant des actions.
 * Critère : fichier .js tracké sous functions/ (hors node_modules et __tests__)
 * produisant AU MOINS UNE action extraite.
 *
 * Le test de découverte est EXACTEMENT celui de l'extraction : un fichier qui
 * ne contient que des accès de propriété (`p.action === 'validate'`) ou des
 * commentaires n'est pas retenu — il ne produirait aucune ligne de carte mais
 * polluerait le fingerprint (fausse péremption au moindre changement métier).
 * @param {string} root
 * @returns {string[]} chemins relatifs triés
 */
function discoverActionFiles(root) {
  return gitListFiles(root, 'functions/')
    .filter(f => f.endsWith('.js'))
    .filter(f => !f.split('/').includes('node_modules'))
    .filter(f => !isInTests(f))
    .filter(f => {
      const content = readFileSafe(path.join(root, f));
      return content !== null && parseActions(content, f).length > 0;
    });
}

/**
 * Parse les handlers `exports.xxx =` (début de ligne) avec leur numéro de ligne.
 * @param {string} content
 * @returns {Array<{ name: string, line: number }>}
 */
function parseExportHandlers(content) {
  const pattern = /^exports\.([a-zA-Z][a-zA-Z0-9_]*)\s*=/gm;
  /** @type {Array<{ name: string, line: number }>} */
  const out = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    out.push({
      name: match[1],
      line: content.slice(0, match.index).split('\n').length,
    });
  }
  return out;
}

/**
 * Retourne le dernier handler déclaré AVANT `line`, ou le fallback.
 * @param {Array<{ name: string, line: number }>} handlers pré-calculés (ordre source)
 * @param {number} line
 * @param {string} fallback
 * @returns {string}
 */
function findHandlerForLine(handlers, line, fallback) {
  let found = null;
  for (const h of handlers) {
    if (h.line < line) found = h.name;
    else break;
  }
  return found || fallback;
}

/**
 * Parse les actions `action === "..."` d'un fichier.
 *
 * Couvre `if`, `else if`, le ternaire et surtout la DISJONCTION
 * (`if (action === "a" || action === "b")`) — chaque membre donne une ligne.
 * Ignore les commentaires, les chaînes et les accès de propriété.
 * @param {string} content
 * @param {string} relFile chemin relatif repo
 * @returns {Array<{ action: string, method: string|null, file: string, line: number, handler: string }>}
 */
function parseActions(content, relFile) {
  // Le masque a la même longueur que la source : les index (et donc les
  // numéros de ligne) restent ceux du fichier réel.
  const masked = maskComments(content);
  const pattern = new RegExp(ACTION_PATTERN.source, 'g');
  const handlers = parseExportHandlers(content);
  const fallback = path.basename(relFile);
  /** @type {Array<{ action: string, method: string|null, file: string, line: number, handler: string }>} */
  const out = [];
  let match;
  while ((match = pattern.exec(masked)) !== null) {
    const line = content.slice(0, match.index).split('\n').length;
    out.push({
      action: match[1],
      method: match[2] || null,
      file: relFile,
      line,
      handler: findHandlerForLine(handlers, line, fallback),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Section B — Composants frontend
// ---------------------------------------------------------------------------

/**
 * Déclaration classique `function Xxx(`.
 *
 * L'indentation est `[ \t]*` et NON `\s*` : `\s` inclut `\n`, donc `^\s*`
 * démarre le match sur la ligne VIDE précédente et `match.index` pointe une
 * ligne trop haut. Cf. `"\n\nfunction Foo(){}"` → index 0 (ligne 1, faux)
 * avec `^\s*`, index 2 (ligne 3, correct) avec `^[ \t]*`.
 */
const COMPONENT_DECLARATION_PATTERN = /^[ \t]*function ([A-Z]\w*)\s*\(/gm;

/**
 * Composant écrit en EXPRESSION : `var Gauge = function(pr) {`,
 * `const NotificationPopup = () => {`, `const X = async props => {`.
 * Une simple correspondance ne suffit pas : la même forme sert aux alias
 * utilitaires (`const PU = (typeof window !== 'undefined' && window.PaieUtils)
 * ? … : null`). Le corps est donc soumis à `looksLikeComponentBody`.
 */
const COMPONENT_EXPRESSION_PATTERN =
  /^[ \t]*(?:const|let|var) ([A-Z]\w*)\s*=\s*(?:async\s+)?(?:function\s*[\w$]*\s*\(|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gm;

/**
 * Trouve l'index de la fin du corps ouvert par le délimiteur situé à `openIdx`.
 * Comptage de délimiteurs en ignorant chaînes, gabarits et commentaires — donc
 * robuste quelle que soit la longueur du corps (celui de `NotificationPopup`
 * fait ~110 lignes ; une fenêtre fixe de N lignes le tronquerait).
 * @param {string} content
 * @param {number} openIdx index du `{` ou `(` ouvrant
 * @returns {number} index du délimiteur fermant, ou content.length si non trouvé
 */
function findBodyEnd(content, openIdx) {
  const open = content[openIdx];
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  let i = openIdx;
  const n = content.length;
  while (i < n) {
    const c = content[i];
    const next = content[i + 1];

    if (c === '/' && next === '/') {
      while (i < n && content[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i += 1;
      while (i < n) {
        if (content[i] === '\\') {
          i += 2;
          continue;
        }
        if (content[i] === quote) break;
        if (quote !== '`' && content[i] === '\n') break;
        i += 1;
      }
      i += 1;
      continue;
    }

    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return n;
}

/**
 * Discriminant « ce corps rend-il du React ? ».
 *
 * Deux styles cohabitent dans app.jsx et il faut les DEUX :
 *   - `React.createElement(` — ex. Gauge (L41352), ChartSVG ;
 *   - retour JSX — ex. NotificationPopup, dont le corps (68315→68425) ne
 *     contient AUCUN `React.createElement` : `return (` puis une ligne
 *     commençant par `<`.
 * Les alias utilitaires (`PU`, `RK`, `MC`, `Guard`, `EC`, `CU`) n'ont ni l'un
 * ni l'autre et sont donc rejetés.
 * @param {string} body
 * @returns {boolean}
 */
function looksLikeComponentBody(body) {
  if (body.includes('React.createElement(')) return true;
  if (/return\s*</.test(body)) return true;
  // `return (` puis une ligne dont le premier caractère non-blanc est `<`
  if (/return\s*\(\s*\n\s*</.test(body)) return true;
  // Retour JSX implicite d'une flèche : le corps EST `( <div/> )`
  if (/^\(\s*</.test(body)) return true;
  return false;
}

/**
 * Parse les composants React d'un source : déclarations `function Xxx(` et
 * expressions `const/let/var Xxx = function|=>` dont le corps rend du React.
 * @param {string} content
 * @param {string} relFile
 * @returns {Array<{ name: string, file: string, line: number }>} triés par ligne
 */
function parseComponents(content, relFile) {
  /** @type {Array<{ name: string, file: string, line: number }>} */
  const out = [];
  /** @param {number} index @returns {number} */
  const lineOf = index => content.slice(0, index).split('\n').length;

  const declPattern = new RegExp(COMPONENT_DECLARATION_PATTERN.source, 'gm');
  let match;
  while ((match = declPattern.exec(content)) !== null) {
    out.push({ name: match[1], file: relFile, line: lineOf(match.index) });
  }

  const exprPattern = new RegExp(COMPONENT_EXPRESSION_PATTERN.source, 'gm');
  while ((match = exprPattern.exec(content)) !== null) {
    // Début du corps = premier caractère non-blanc après la signature :
    // `{` pour un bloc, `(` pour un retour JSX implicite (`=> (<div/>)`).
    // Pour `function (args) {`, la parenthèse des paramètres est encore à
    // consommer : on saute jusqu'à sa fermeture.
    let cursor = match.index + match[0].length;
    if (match[0].trimEnd().endsWith('(')) {
      cursor = findBodyEnd(content, cursor - 1) + 1;
    }
    const openRel = content.slice(cursor).search(/\S/);
    if (openRel === -1) continue;
    const openIdx = cursor + openRel;
    if (content[openIdx] !== '{' && content[openIdx] !== '(') continue;

    const body = content.slice(openIdx, findBodyEnd(content, openIdx) + 1);
    if (!looksLikeComponentBody(body)) continue;
    out.push({ name: match[1], file: relFile, line: lineOf(match.index) });
  }

  out.sort((a, b) => a.line - b.line);
  return out;
}

/**
 * Parse les appels `renderTab('tabId', Component, …)` → map composant → tabId.
 * @param {string} content
 * @returns {Record<string, string>}
 */
function parseRenderTabs(content) {
  const pattern = /renderTab\(\s*'([\w_]+)'\s*,\s*(?:window\.)?(\w+)\s*,/g;
  /** @type {Record<string, string>} */
  const out = {};
  let match;
  while ((match = pattern.exec(content)) !== null) {
    if (!out[match[2]]) out[match[2]] = match[1];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Section C — Modules lib
// ---------------------------------------------------------------------------

/**
 * Extrait les identifiants exportables du corps d'un objet littéral.
 * Ignore les spreads, commentaires et valeurs ; pour `key: value` garde `key`.
 * @param {string} body
 * @returns {string[]}
 */
function extractObjectKeys(body) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  const tokens = body.split(/[,\n]/);
  for (const raw of tokens) {
    let token = raw.trim();
    if (!token) continue;
    if (token.startsWith('//') || token.startsWith('*') || token.startsWith('/*')) continue;
    if (token.includes(':')) token = token.split(':')[0].trim();
    if (!/^\w+$/.test(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Cherche le corps d'un objet littéral affecté à `<varName>`.
 * Ex. `const api = {\n  a,\n  b,\n};`
 * @param {string} content
 * @param {string} varName
 * @returns {string|null}
 */
function findVarObjectBody(content, varName) {
  const multi = content.match(
    new RegExp('(?:const|let|var)\\s+' + varName + '\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};')
  );
  if (multi) return multi[1];
  const inline = content.match(
    new RegExp('(?:const|let|var)\\s+' + varName + '\\s*=\\s*\\{([^}]*)\\}')
  );
  return inline ? inline[1] : null;
}

/**
 * Parse les clés exportées d'un module backend (`module.exports = …`).
 * Trois formes couvertes (best-effort, jamais d'exception) :
 *   1. objet littéral multiligne  `module.exports = {\n a,\n b,\n};`
 *   2. objet littéral inline      `module.exports = { a, b };`
 *   3. indirection par variable   `const api = {…}; module.exports = api;`
 * @param {string} content
 * @returns {string[]}
 */
function parseModuleExportsKeys(content) {
  const multi = content.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (multi) return extractObjectKeys(multi[1]);

  const inline = content.match(/module\.exports\s*=\s*\{([^}]*)\}/);
  if (inline) return extractObjectKeys(inline[1]);

  const indirect = content.match(/module\.exports\s*=\s*(\w+)\s*;/);
  if (indirect) {
    const body = findVarObjectBody(content, indirect[1]);
    if (body) return extractObjectKeys(body);
  }
  return [];
}

/**
 * Parse un module public/lib/*.js (UMD bricolé) : nom global + fonctions exposées.
 * Best-effort — ne lève jamais.
 * @param {string} content
 * @returns {{ globalName: string|null, functions: string[] }}
 */
function parsePublicLibExports(content) {
  /** @type {string|null} */
  let globalName = null;
  /** @type {string[]} */
  let functions = [];

  // Forme 1 : window.X = apiVar;  (forme dominante)
  const varAssign = content.match(/window\.(\w+)\s*=\s*(\w+)\s*;/);
  if (varAssign) {
    globalName = varAssign[1];
    const body = findVarObjectBody(content, varAssign[2]);
    if (body) functions = extractObjectKeys(body);
  }

  // Forme 2 : window.X = { … } inline (emargementExcel, emargementPdf)
  if (!globalName || functions.length === 0) {
    const inline = content.match(/window\.(\w+)\s*=\s*\{([^}]*)\}/);
    if (inline) {
      if (!globalName) globalName = inline[1];
      if (functions.length === 0) functions = extractObjectKeys(inline[2]);
    }
  }

  // Forme 3 : UMD `root.X = api;` (authResilience, inflightDedup, primesImportParse, primesV2)
  if (!globalName || functions.length === 0) {
    const rootAssign = content.match(/root\.(\w+)\s*=\s*(\w+)\s*;/);
    if (rootAssign && !globalName) globalName = rootAssign[1];
    if (functions.length === 0) {
      // L'API d'un UMD est retournée par la factory : dernier `return { … };`
      const returnPattern = /return\s*\{([\s\S]*?)\n\s*\};/g;
      let m;
      let last = null;
      while ((m = returnPattern.exec(content)) !== null) last = m[1];
      if (last) functions = extractObjectKeys(last);
    }
  }

  // Forme 4 : nom global depuis le commentaire d'en-tête
  if (!globalName) {
    const header = content.split('\n').slice(0, 10).join('\n');
    const headerMatch = header.match(/window\.(\w+)/);
    if (headerMatch) globalName = headerMatch[1];
  }

  return { globalName, functions };
}

// ---------------------------------------------------------------------------
// require-index
// ---------------------------------------------------------------------------

/**
 * Parse les require() relatifs d'un source.
 * @param {string} content
 * @returns {string[]}
 */
function parseRelativeRequires(content) {
  const pattern = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  /** @type {string[]} */
  const out = [];
  let match;
  while ((match = pattern.exec(content)) !== null) out.push(match[1]);
  return out;
}

/**
 * Résout un require relatif : littéral, +.js, +.jsx, +/index.js.
 * @param {string} fromDirAbs répertoire du fichier appelant (absolu)
 * @param {string} spec
 * @param {(p: string) => boolean} exists prédicat « existe ET est un FICHIER »
 *   (un require('..') pointe sur un répertoire : il ne doit pas matcher le
 *   chemin littéral, sinon on rate le /index.js)
 * @returns {string|null} chemin absolu résolu, ou null
 */
function resolveRequirePath(fromDirAbs, spec, exists) {
  const base = path.resolve(fromDirAbs, spec);
  const candidates = [base, base + '.js', base + '.jsx', path.join(base, 'index.js')];
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * True si un chemin relatif POSIX tombe sous l'un des arbres cibles.
 * @param {string} relPath
 * @returns {boolean}
 */
function isTargetFile(relPath) {
  if (isInTests(relPath)) return false;
  if (!TARGET_EXTENSIONS.includes(path.extname(relPath))) return false;
  return TARGET_TREES.some(tree => relPath === tree || relPath.startsWith(tree + '/'));
}

/**
 * Fermeture transitive : ensemble des nœuds atteignables depuis `seeds`
 * en suivant `graph` (seeds inclus). Résiste aux cycles.
 * @param {Record<string, string[]>} graph noeud → dépendances
 * @param {string[]} seeds
 * @returns {string[]} trié
 */
function reachableFrom(graph, seeds) {
  const visited = new Set();
  const stack = [...seeds];
  while (stack.length > 0) {
    const node = /** @type {string} */ (stack.pop());
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of graph[node] || []) {
      if (!visited.has(next)) stack.push(next);
    }
  }
  return [...visited].sort();
}

// ---------------------------------------------------------------------------
// Collecte
// ---------------------------------------------------------------------------

/**
 * Liste les fichiers cibles du require-index.
 * @param {string} root
 * @returns {string[]}
 */
function listTargetFiles(root) {
  /** @type {string[]} */
  let out = [];
  for (const tree of TARGET_TREES) {
    out = out.concat(walkFiles(root, tree, isTargetFile));
  }
  return out.sort();
}

/**
 * Liste les fichiers de test scannés (mêmes globs que `npm run qa`).
 * @param {string} root
 * @returns {string[]}
 */
function listTestFiles(root) {
  const unit = walkFiles(root, 'tests/unit', p => p.endsWith('.test.js'));
  const backend = ['functions/lib', 'functions/middleware'].reduce(
    /** @param {string[]} acc @param {string} tree */
    (acc, tree) => acc.concat(walkFiles(root, tree, p => p.endsWith('.test.js') && isInTests(p))),
    /** @type {string[]} */ ([])
  );
  return unit.concat(backend).sort();
}

/**
 * Charge une liste de fichiers relatifs en {path, content} (ignore les absents).
 * @param {string} root
 * @param {string[]} rels
 * @returns {Array<{ path: string, content: string }>}
 */
function loadSources(root, rels) {
  /** @type {Array<{ path: string, content: string }>} */
  const sources = [];
  const seen = new Set();
  for (const rel of rels) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const content = readFileSafe(path.join(root, rel));
    if (content !== null) sources.push({ path: rel, content });
  }
  return sources;
}

/**
 * Sources du fingerprint « actions » : contenu des fichiers découverts
 * dynamiquement + le listing (pour capter un ajout/retrait de fichier).
 * @param {string} root
 * @returns {Array<{ path: string, content: string }>}
 */
function collectActionsSources(root) {
  const files = discoverActionFiles(root);
  const sources = loadSources(root, files);
  sources.push({ path: '__action_files__', content: JSON.stringify(files) });
  return sources;
}

/**
 * Liste les fichiers sources des composants (app.jsx en premier).
 * @param {string} root
 * @returns {string[]}
 */
function listComponentFiles(root) {
  return ['public/app.jsx'].concat(walkFiles(root, 'public/components', p => p.endsWith('.jsx')));
}

/**
 * Sources du fingerprint « components ».
 * @param {string} root
 * @returns {Array<{ path: string, content: string }>}
 */
function collectComponentsSources(root) {
  return loadSources(root, listComponentFiles(root));
}

/**
 * Liste les fichiers sources des modules lib.
 * @param {string} root
 * @returns {string[]}
 */
function listModuleFiles(root) {
  return walkFiles(root, 'public/lib', p => p.endsWith('.js')).concat(
    walkFiles(root, 'functions/lib', p => p.endsWith('.js') && !isInTests(p))
  );
}

/**
 * Sources du fingerprint « modules ».
 * @param {string} root
 * @returns {Array<{ path: string, content: string }>}
 */
function collectModulesSources(root) {
  return loadSources(root, listModuleFiles(root));
}

/**
 * Sources du fingerprint « require-index » : les ENTRÉES RÉELLES de l'index,
 * jamais le contenu des fichiers.
 *
 * Contrairement aux trois fingerprints code-map — qui DOIVENT rester sur le
 * contenu intégral, parce qu'ils enregistrent des numéros de ligne qu'un simple
 * commentaire ajouté plus haut décale — l'index require ne dépend que de trois
 * structures : le listing des cibles, l'adjacence source→source et les arêtes
 * test→cible. Tout le reste du contenu (assertions, refactor interne) est hors
 * sujet : le faire entrer dans l'empreinte ferait rougir la gate à chaque
 * modification de test, sans qu'une ligne du payload ne bouge.
 * @param {string} root
 * @returns {Array<{ path: string, content: string }>}
 */
function collectRequireIndexSources(root) {
  return buildRequireIndex(root).fingerprintSources;
}

// ---------------------------------------------------------------------------
// Rendu Markdown
// ---------------------------------------------------------------------------

/**
 * Échappe les pipes pour une cellule Markdown.
 * @param {string} s
 * @returns {string}
 */
function mdCell(s) {
  return String(s).replace(/\|/g, '\\|');
}

/**
 * Construit un document Markdown généré (en-tête + table).
 * @param {{ title: string, count: number, description: string, fingerprint: string,
 *           headers: string[], rows: string[][] }} data
 * @returns {string}
 */
function renderMarkdownTable(data) {
  const lines = [];
  lines.push('<!-- GENERATED FILE — ne pas éditer à la main. Régénérer : npm run code-index -->');
  lines.push(`<!-- sourceFingerprint: ${data.fingerprint} -->`);
  lines.push(`# Code Map — ${data.title} (${data.count})`);
  lines.push('');
  lines.push(data.description);
  lines.push('');
  lines.push(`| ${data.headers.join(' | ')} |`);
  lines.push(`| ${data.headers.map(() => '---').join(' | ')} |`);
  for (const row of data.rows) {
    lines.push(`| ${row.map(mdCell).join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Rendu de docs/ai/code-map-actions.md.
 * @param {Array<{ action: string, method: string|null, file: string, line: number, handler: string }>} actions
 * @param {string} fingerprint
 * @returns {string}
 */
function renderActionsMap(actions, fingerprint) {
  return renderMarkdownTable({
    title: 'Actions backend',
    count: actions.length,
    description:
      'Chaque action `?action=<nom>` des Cloud Functions, avec son emplacement exact et le handler `exports.xxx` qui la sert — à consulter AVANT toute recherche dans functions/index.js.',
    fingerprint,
    headers: ['Action', 'Fichier:Ligne', 'Handler', 'Méthode'],
    rows: actions.map(a => [a.action, `${a.file}:${a.line}`, a.handler, a.method || '—']),
  });
}

/**
 * Rendu de docs/ai/code-map-components.md.
 * @param {Array<{ name: string, file: string, line: number, tab: string|null }>} components
 * @param {string} fingerprint
 * @returns {string}
 */
function renderComponentsMap(components, fingerprint) {
  return renderMarkdownTable({
    title: 'Composants frontend',
    count: components.length,
    description:
      'Chaque composant React de public/app.jsx et public/components/, avec son emplacement exact et le tab qui le monte — à consulter AVANT toute recherche dans app.jsx.',
    fingerprint,
    headers: ['Composant', 'Fichier:Ligne', 'Tab'],
    rows: components.map(c => [c.name, `${c.file}:${c.line}`, c.tab || '—']),
  });
}

/**
 * Rendu de docs/ai/code-map-modules.md.
 * @param {Array<{ file: string, globalName: string|null, functions: string[] }>} modules
 * @param {string} fingerprint
 * @returns {string}
 */
function renderModulesMap(modules, fingerprint) {
  return renderMarkdownTable({
    title: 'Modules lib',
    count: modules.length,
    description:
      'API publique de chaque module public/lib/ (UMD `window.X`) et functions/lib/ (`module.exports`) — pour savoir quel helper existe déjà avant d\'en réécrire un.',
    fingerprint,
    headers: ['Fichier', 'Export global', 'Fonctions'],
    rows: modules.map(m => [
      m.file,
      m.globalName || '—',
      m.functions.length > 0 ? m.functions.join(', ') : '— voir fichier —',
    ]),
  });
}

// ---------------------------------------------------------------------------
// Construction des données
// ---------------------------------------------------------------------------

/**
 * Construit la liste des actions backend, triée par nom d'action.
 * @param {string} root
 * @returns {{ actions: Array<{ action: string, method: string|null, file: string, line: number, handler: string }>, files: string[] }}
 */
function buildActions(root) {
  const files = discoverActionFiles(root);
  /** @type {any[]} */
  let actions = [];
  for (const rel of files) {
    const content = readFileSafe(path.join(root, rel));
    if (content === null) continue;
    actions = actions.concat(parseActions(content, rel));
  }
  actions.sort(
    (a, b) => a.action.localeCompare(b.action) || a.file.localeCompare(b.file) || a.line - b.line
  );
  return { actions, files };
}

/**
 * Construit la liste des composants frontend, dédupliquée par nom.
 * @param {string} root
 * @returns {Array<{ name: string, file: string, line: number, tab: string|null }>}
 */
function buildComponents(root) {
  /** @type {Record<string, { name: string, file: string, line: number }>} */
  const byName = {};
  for (const rel of listComponentFiles(root)) {
    const content = readFileSafe(path.join(root, rel));
    if (content === null) continue;
    for (const c of parseComponents(content, rel)) {
      if (!byName[c.name]) byName[c.name] = c;
    }
  }
  const appSource = readFileSafe(path.join(root, 'public/app.jsx')) || '';
  const tabs = parseRenderTabs(appSource);
  return Object.values(byName)
    .map(c => ({ ...c, tab: tabs[c.name] || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Construit la liste des modules lib, triée par chemin.
 * @param {string} root
 * @returns {Array<{ file: string, globalName: string|null, functions: string[] }>}
 */
function buildModules(root) {
  /** @type {Array<{ file: string, globalName: string|null, functions: string[] }>} */
  const modules = [];
  for (const rel of walkFiles(root, 'functions/lib', p => p.endsWith('.js') && !isInTests(p))) {
    const content = readFileSafe(path.join(root, rel));
    if (content === null) continue;
    modules.push({ file: rel, globalName: null, functions: parseModuleExportsKeys(content) });
  }
  for (const rel of walkFiles(root, 'public/lib', p => p.endsWith('.js'))) {
    const content = readFileSafe(path.join(root, rel));
    if (content === null) continue;
    const parsed = parsePublicLibExports(content);
    modules.push({ file: rel, globalName: parsed.globalName, functions: parsed.functions });
  }
  modules.sort((a, b) => a.file.localeCompare(b.file));
  return modules;
}

/**
 * Construit l'index require : cible → { directTests, transitiveTests }.
 * Retourne aussi les sources et la valeur du fingerprint (arêtes uniquement,
 * jamais de contenu de fichier — cf. `collectRequireIndexSources`).
 * @param {string} root
 * @returns {{ index: Record<string, { directTests: string[], transitiveTests: string[] }>,
 *             stats: { targetFiles: number, targetFilesWithDirectTests: number,
 *                      targetFilesWithTransitiveTests: number, testFilesScanned: number },
 *             fingerprintSources: Array<{ path: string, content: string }>,
 *             fingerprint: string }}
 */
function buildRequireIndex(root) {
  const targets = listTargetFiles(root);
  const tests = listTestFiles(root);

  const exists = /** @param {string} p */ p => {
    try {
      return fs.statSync(p).isFile();
    } catch (e) {
      return false;
    }
  };

  /** Résout les require relatifs d'un fichier vers des cibles. @type {(rel: string) => string[]} */
  const targetDepsOf = rel => {
    const abs = path.join(root, rel);
    const content = readFileSafe(abs);
    if (content === null) return [];
    /** @type {string[]} */
    const out = [];
    for (const spec of parseRelativeRequires(content)) {
      const resolved = resolveRequirePath(path.dirname(abs), spec, exists);
      if (!resolved) continue;
      const relResolved = path.relative(root, resolved).split(path.sep).join('/');
      if (!isTargetFile(relResolved)) continue;
      if (!out.includes(relResolved)) out.push(relResolved);
    }
    return out;
  };

  // 1. Graphe source→source entre fichiers cibles.
  /** @type {Record<string, string[]>} */
  const sourceGraph = {};
  for (const t of targets) sourceGraph[t] = targetDepsOf(t);

  // 2. Tests → cibles directes, puis propagation transitive (cycles gérés).
  /** @type {Record<string, Set<string>>} */
  const direct = {};
  /** @type {Record<string, Set<string>>} */
  const transitive = {};
  for (const t of targets) {
    direct[t] = new Set();
    transitive[t] = new Set();
  }

  /** Arêtes test → cible résolue, matière première du fingerprint. @type {string[][]} */
  const directEdges = [];

  for (const testRel of tests) {
    const seeds = targetDepsOf(testRel);
    for (const seed of seeds) {
      if (direct[seed]) {
        direct[seed].add(testRel);
        directEdges.push([testRel, seed]);
      }
    }
    for (const reached of reachableFrom(sourceGraph, seeds)) {
      if (transitive[reached]) transitive[reached].add(testRel);
    }
  }
  directEdges.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

  /** @type {Record<string, { directTests: string[], transitiveTests: string[] }>} */
  const index = {};
  for (const t of targets) {
    index[t] = {
      directTests: [...direct[t]].sort(),
      transitiveTests: [...transitive[t]].sort(),
    };
  }

  // 3. Sources du fingerprint : les trois structures qui déterminent
  //    ENTIÈREMENT le payload, sérialisées triées, sans aucun contenu.
  /** @type {Array<{ path: string, content: string }>} */
  const fingerprintSources = [
    { path: '__target_files__', content: JSON.stringify(targets) },
    { path: '__source_graph__', content: JSON.stringify(sortKeysDeep(sourceGraph)) },
    { path: '__direct_edges__', content: JSON.stringify(directEdges) },
  ];

  const values = Object.values(index);
  return {
    index,
    stats: {
      targetFiles: targets.length,
      targetFilesWithDirectTests: values.filter(v => v.directTests.length > 0).length,
      targetFilesWithTransitiveTests: values.filter(v => v.transitiveTests.length > 0).length,
      testFilesScanned: tests.length,
    },
    fingerprintSources,
    fingerprint: computeFingerprint(fingerprintSources),
  };
}

// ---------------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------------

/**
 * Fabrique le fingerprint d'une sortie.
 * @param {string} root
 * @param {'actions'|'components'|'modules'|'require-index'} which
 * @returns {string}
 */
function fingerprintFor(root, which) {
  if (which === 'actions') return computeFingerprint(collectActionsSources(root));
  if (which === 'components') return computeFingerprint(collectComponentsSources(root));
  if (which === 'modules') return computeFingerprint(collectModulesSources(root));
  // Un seul chemin de calcul, partagé avec la génération : pas de duplication
  // qui pourrait diverger entre le CLI --fingerprint-only et le fichier écrit.
  if (which === 'require-index') return buildRequireIndex(root).fingerprint;
  throw new Error(`fingerprint inconnu: ${which}`);
}

/**
 * Génère les quatre sorties sur disque.
 * @param {string} root
 * @param {{ outDir?: string }} [opts] répertoire de sortie (défaut docs/ai)
 * @returns {{ actions: number, actionFiles: number, components: number, modules: number,
 *             requireStats: { targetFiles: number, targetFilesWithDirectTests: number,
 *                             targetFilesWithTransitiveTests: number, testFilesScanned: number } }}
 */
function generate(root, opts) {
  const outDir = (opts && opts.outDir) || path.join(root, 'docs/ai');
  fs.mkdirSync(outDir, { recursive: true });

  const { actions, files: actionFiles } = buildActions(root);
  fs.writeFileSync(
    path.join(outDir, 'code-map-actions.md'),
    renderActionsMap(actions, fingerprintFor(root, 'actions')),
    'utf8'
  );

  const components = buildComponents(root);
  fs.writeFileSync(
    path.join(outDir, 'code-map-components.md'),
    renderComponentsMap(components, fingerprintFor(root, 'components')),
    'utf8'
  );

  const modules = buildModules(root);
  fs.writeFileSync(
    path.join(outDir, 'code-map-modules.md'),
    renderModulesMap(modules, fingerprintFor(root, 'modules')),
    'utf8'
  );

  const requireIndex = buildRequireIndex(root);
  const payload = {
    _meta: {
      schemaVersion: SCHEMA_VERSION,
      generatorVersion: GENERATOR_VERSION,
      sourceFingerprint: requireIndex.fingerprint,
      stats: requireIndex.stats,
    },
    index: sortKeysDeep(requireIndex.index),
  };
  fs.writeFileSync(
    path.join(outDir, 'require-index.json'),
    JSON.stringify(payload, null, 2) + '\n',
    'utf8'
  );

  return {
    actions: actions.length,
    actionFiles: actionFiles.length,
    components: components.length,
    modules: modules.length,
    requireStats: requireIndex.stats,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const fpArg = process.argv.find(a => a.startsWith('--fingerprint-only='));
  if (fpArg) {
    const which = fpArg.split('=')[1];
    if (['actions', 'components', 'modules', 'require-index'].includes(which)) {
      console.log(fingerprintFor(root, /** @type {any} */ (which)));
      process.exit(0);
    }
    console.error('Usage: --fingerprint-only=actions|components|modules|require-index');
    process.exit(1);
  }

  try {
    const stats = generate(root);
    console.log(
      `[code-index] code-map-actions.md : ${stats.actions} actions (${stats.actionFiles} fichiers découverts)`
    );
    console.log(`[code-index] code-map-components.md : ${stats.components} composants`);
    console.log(`[code-index] code-map-modules.md : ${stats.modules} modules`);
    console.log(
      `[code-index] require-index.json : ${stats.requireStats.targetFiles} cibles, ` +
        `${stats.requireStats.targetFilesWithDirectTests} avec test direct, ` +
        `${stats.requireStats.targetFilesWithTransitiveTests} avec test transitif ` +
        `(${stats.requireStats.testFilesScanned} tests scannés)`
    );
  } catch (err) {
    console.error('code-index error:', err.message);
    process.exit(1);
  }
}

module.exports = {
  TARGET_TREES,
  ACTION_PATTERN,
  maskComments,
  discoverActionFiles,
  gitListFiles,
  parseExportHandlers,
  findHandlerForLine,
  parseActions,
  parseComponents,
  findBodyEnd,
  looksLikeComponentBody,
  parseRenderTabs,
  extractObjectKeys,
  findVarObjectBody,
  parseModuleExportsKeys,
  parsePublicLibExports,
  parseRelativeRequires,
  resolveRequirePath,
  reachableFrom,
  isTargetFile,
  isInTests,
  walkFiles,
  listTargetFiles,
  listTestFiles,
  listComponentFiles,
  listModuleFiles,
  collectActionsSources,
  collectComponentsSources,
  collectModulesSources,
  collectRequireIndexSources,
  renderMarkdownTable,
  renderActionsMap,
  renderComponentsMap,
  renderModulesMap,
  buildActions,
  buildComponents,
  buildModules,
  buildRequireIndex,
  fingerprintFor,
  generate,
};
