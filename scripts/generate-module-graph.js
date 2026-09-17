'use strict';
// @ts-check

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SCHEMA_VERSION = 1;
const GENERATOR_VERSION = '1.0.3';

// Fichiers exclus de l'analyse git coupling
const GIT_COUPLING_EXCLUDE = [
  /^package-lock\.json$/,
  /^package\.json$/,
  /\.min\.js$/,
  /^public\/index\.html$/, // cache-bust version bumps
  /^docs\//,               // documentation
];

/**
 * Normalise un nom de fichier/identifiant pour la correspondance de mots-clés.
 * "PrimesFixesTab.jsx" → "primesfixestab"
 * "paie-utils" → "paieutils"
 * @param {string} s
 * @returns {string}
 */
function normalizeForClassify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Classifie un nom par rapport aux définitions de domaines.
 * Score par longueur de keyword (plus long = plus spécifique).
 * @param {string} name
 * @param {Record<string, { keywords: string[], label?: string, seedFiles?: string[] }>} domains
 * @returns {{ domain: string|null, confidence: 'high'|'medium'|'low', scores: Record<string, number> }}
 */
function classifyByKeywords(name, domains) {
  const normalized = normalizeForClassify(name);
  /** @type {Record<string, number>} */
  const scores = {};

  for (const [domainKey, domainDef] of Object.entries(domains)) {
    let score = 0;
    for (const kw of domainDef.keywords) {
      const normalizedKw = normalizeForClassify(kw);
      if (normalized.includes(normalizedKw)) {
        score += normalizedKw.length;
      }
    }
    scores[domainKey] = score;
  }

  // Trouver le score max
  let maxScore = 0;
  for (const s of Object.values(scores)) {
    if (s > maxScore) maxScore = s;
  }

  if (maxScore === 0) {
    return { domain: null, confidence: 'low', scores };
  }

  // Compter les domaines avec le score max
  const winners = Object.keys(scores).filter(k => scores[k] === maxScore);

  if (winners.length > 1) {
    // Ex-aequo → premier dans l'ordre des clés de l'objet domains
    const firstWinner = Object.keys(domains).find(k => winners.includes(k)) || winners[0];
    return { domain: firstWinner, confidence: 'low', scores };
  }

  // Gagnant unique
  const winner = winners[0];
  const confidence = maxScore >= 6 ? 'high' : 'medium';
  return { domain: winner, confidence, scores };
}

/**
 * Parse window\.([A-Z][a-zA-Z0-9]+)\s*= dans une chaîne source.
 * Retourne un tableau de noms uniques, dans l'ordre d'apparition.
 * @param {string} source
 * @returns {string[]}
 */
function parseWindowExports(source) {
  const pattern = /window\.([A-Z][a-zA-Z0-9]+)\s*=/g;
  const seen = new Set();
  const results = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      results.push(match[1]);
    }
  }
  return results;
}

/**
 * Parse ^exports\.([a-zA-Z][a-zA-Z0-9_]*)\s*= (multiline) dans une chaîne.
 * Retourne un tableau de noms uniques, dans l'ordre d'apparition.
 * @param {string} source
 * @returns {string[]}
 */
function parseCFExports(source) {
  const pattern = /^exports\.([a-zA-Z][a-zA-Z0-9_]*)\s*=/gm;
  const seen = new Set();
  const results = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      results.push(match[1]);
    }
  }
  return results;
}

/**
 * Parse les rewrites firebase.json.
 * @param {any} firebaseJson
 * @returns {Array<{ source: string, functionId: string }>}
 */
function parseFirebaseRewrites(firebaseJson) {
  const rewrites = firebaseJson && firebaseJson.hosting && firebaseJson.hosting.rewrites;
  if (!Array.isArray(rewrites)) return [];
  const results = [];
  for (const rw of rewrites) {
    if (!rw.function) continue;
    const functionId = typeof rw.function === 'object'
      ? rw.function.functionId
      : rw.function;
    if (rw.source && functionId) {
      results.push({ source: rw.source, functionId });
    }
  }
  return results;
}

/**
 * Parse les collections Firestore depuis les rules.
 * Exclut `database`, `documents`, et les wildcards commençant par `{`.
 * @param {string} rulesSource
 * @returns {string[]}
 */
function parseFirestoreCollections(rulesSource) {
  const pattern = /match\s+\/([a-zA-Z_][a-zA-Z0-9_]+)\/(\{|$)/g;
  const seen = new Set();
  const results = [];
  let match;
  while ((match = pattern.exec(rulesSource)) !== null) {
    const name = match[1];
    if (name === 'database' || name === 'databases' || name === 'documents') continue;
    if (!seen.has(name)) {
      seen.add(name);
      results.push(name);
    }
  }
  return results;
}

/**
 * Calcule un fingerprint SHA-256 des fichiers sources.
 * @param {Array<{ path: string, content: string }>} files
 * @returns {string}
 */
function computeFingerprint(files) {
  const hash = crypto.createHash('sha256');
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    hash.update(file.path + ':');
    hash.update(file.content, 'utf8');
    hash.update('\n');
  }
  return 'sha256:' + hash.digest('hex').slice(0, 16);
}

/**
 * Retourne true si le fichier doit être exclu de l'analyse co-commits.
 * @param {string} filePath
 * @returns {boolean}
 */
function isExcludedFromGitCoupling(filePath) {
  for (const pattern of GIT_COUPLING_EXCLUDE) {
    if (pattern.test(filePath)) return true;
  }
  return false;
}

/**
 * Calcule le score de santé du graphe.
 * @param {{ classifiedFiles: number, totalFiles: number, modulesWithTests: number, totalModules: number, domainsWithFullStack: number, totalDomains: number }} data
 */
function computeHealthScore(data) {
  const { classifiedFiles, totalFiles, modulesWithTests, totalModules, domainsWithFullStack, totalDomains } = data;

  const classScore = totalFiles === 0 ? 0 : Math.round(40 * classifiedFiles / totalFiles);
  const testScore = totalModules === 0 ? 0 : Math.round(30 * modulesWithTests / totalModules);
  const domainScore = totalDomains === 0 ? 0 : Math.round(30 * domainsWithFullStack / totalDomains);

  return {
    total: classScore + testScore + domainScore,
    subScores: {
      classification: {
        score: classScore,
        max: 40,
        detail: `${classifiedFiles}/${totalFiles} fichiers classifiés`,
      },
      testCoverage: {
        score: testScore,
        max: 30,
        detail: `${modulesWithTests}/${totalModules} modules avec ≥1 test`,
      },
      domainCompleteness: {
        score: domainScore,
        max: 30,
        detail: `${domainsWithFullStack}/${totalDomains} domaines avec frontend+backend+firestore`,
      },
    },
  };
}

/**
 * Construit l'index symbole → localisation (fichier de src/modules + ligne).
 * Seule la première occurrence de chaque nom est retenue.
 * @param {Array<{ name: string, file: string, approxLine: number, domain: string|null }>} tabs
 * @returns {Record<string, { domain: string|null, file: string, line: number }>}
 */
function buildTabIndex(tabs) {
  const index = {};
  for (const tab of tabs) {
    if (!index[tab.name]) {
      index[tab.name] = {
        domain: tab.domain,
        file: tab.file,
        line: tab.approxLine,
      };
    }
  }
  return index;
}

/**
 * Liste récursive des fichiers d'un dossier (chemins relatifs à root, triés).
 * @param {string} root
 * @param {string} rel dossier de départ, relatif à root
 * @param {(p: string) => boolean} keep
 * @returns {string[]}
 */
function walkFiles(root, rel, keep) {
  const start = path.join(root, rel);
  if (!fs.existsSync(start)) return [];
  /** @type {string[]} */
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (keep(e.name)) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  })(start);
  return out;
}

/**
 * Tri récursif des clés d'objets pour sérialisation JSON déterministe.
 * Les tableaux de strings sont triés alphabétiquement.
 * Les tableaux d'objets gardent leur ordre d'insertion.
 * @param {any} value
 * @returns {any}
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    if (value.every(v => typeof v === 'string')) return [...value].sort();
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const sorted = /** @type {Record<string, any>} */ ({});
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Lit un fichier en toute sécurité — retourne null si absent.
 * @param {string} filePath
 * @returns {string|null}
 */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.warn(`[DIL] Warning: impossible de lire ${filePath}`);
    return null;
  }
}

/**
 * Collecte les sources pour le fingerprint.
 * @param {string} root
 * @returns {Array<{ path: string, content: string }>}
 */
function collectFingerprintSources(root) {
  /** @type {Array<{ path: string, content: string }>} */
  const sources = [];

  // Fichiers de config fixes
  const fixedFiles = [
    'docs/ai/domains.json',
    'firebase.json',
    'firestore.rules',
    'functions/index.js',
  ];
  for (const rel of fixedFiles) {
    const content = readFileSafe(path.join(root, rel));
    if (content !== null) {
      sources.push({ path: rel, content });
    }
  }

  // src/modules/**/*.jsx (triés) — le frontend
  for (const rel of walkFiles(root, 'src/modules', f => f.endsWith('.jsx'))) {
    const content = readFileSafe(path.join(root, rel));
    if (content !== null) sources.push({ path: rel, content });
  }

  // public/lib/*.js (triés)
  const libDir = path.join(root, 'public/lib');
  if (fs.existsSync(libDir)) {
    const libFiles = fs.readdirSync(libDir).filter(f => f.endsWith('.js')).sort();
    for (const f of libFiles) {
      const content = readFileSafe(path.join(libDir, f));
      if (content !== null) sources.push({ path: `public/lib/${f}`, content });
    }
  }

  // public/components/*.jsx seulement (pas les .js compilés)
  const compDir = path.join(root, 'public/components');
  if (fs.existsSync(compDir)) {
    const compFiles = fs.readdirSync(compDir).filter(f => f.endsWith('.jsx')).sort();
    for (const f of compFiles) {
      const content = readFileSafe(path.join(compDir, f));
      if (content !== null) sources.push({ path: `public/components/${f}`, content });
    }
  }

  // functions/lib/ : liste des entrées seulement (pas le contenu)
  // git ls-files pour exclure .DS_Store et autres artefacts filesystem non-trackés
  const flDir = path.join(root, 'functions/lib');
  if (fs.existsSync(flDir)) {
    let entries;
    try {
      const raw = execSync(`git -C "${root}" ls-files functions/lib/`, { encoding: 'utf8' }).trim().split('\n');
      const firstLevel = raw
        .map(f => { const m = f.match(/^functions\/lib\/([^/]+)/); return m ? m[1] : null; })
        .filter(Boolean);
      entries = [...new Set(firstLevel)].sort();
    } catch (e) {
      entries = fs.readdirSync(flDir).filter(e => !e.startsWith('.')).sort();
    }
    sources.push({ path: 'functions/lib/__entries__', content: JSON.stringify(entries) });
  }

  // functions/*.js racine (services, hors index.js) : liste des noms trackés seulement
  // On utilise git ls-files pour exclure les fichiers gitignorés (ex. test-whatsapp.js)
  // qui varieraient par machine et rendraient le fingerprint non déterministe.
  const functionsRootDir = path.join(root, 'functions');
  if (fs.existsSync(functionsRootDir)) {
    let rootServices;
    try {
      rootServices = execSync(`git -C "${root}" ls-files functions/`, { encoding: 'utf8' })
        .trim().split('\n')
        .filter(f => /^functions\/[^/]+\.js$/.test(f) && !f.endsWith('/index.js') && f !== 'functions/index.js')
        .map(f => path.basename(f))
        .sort();
    } catch (e) {
      // Fallback si git indisponible
      rootServices = fs.readdirSync(functionsRootDir)
        .filter(f => f.endsWith('.js') && f !== 'index.js')
        .sort();
    }
    sources.push({ path: 'functions/__root_services__', content: JSON.stringify(rootServices) });
  }

  return sources;
}

/**
 * Génère le graphe de modules.
 * @param {string} root
 * @returns {Promise<void>}
 */
async function generateGraph(root, outPath) {
  // 1. Charger domains.json
  const domainsConfig = JSON.parse(
    fs.readFileSync(path.join(root, 'docs/ai/domains.json'), 'utf8')
  );
  const domains = domainsConfig.domains;

  // 2. Collecter les sources pour le fingerprint
  const fingerprintSources = collectFingerprintSources(root);

  // 3. Scanner public/lib/*.js
  const libDir = path.join(root, 'public/lib');
  const libFiles = fs.existsSync(libDir)
    ? fs.readdirSync(libDir).filter(f => f.endsWith('.js')).sort()
    : [];

  /** @type {Array<{ file: string, windowExport: string|null, domain: string|null, confidence: string, hasTests: boolean, testFile: string|null }>} */
  const libs = [];
  for (const f of libFiles) {
    const relPath = `public/lib/${f}`;
    const content = readFileSafe(path.join(root, relPath)) || '';
    const windowExports = parseWindowExports(content);
    const classified = classifyByKeywords(f.replace('.js', ''), domains);
    const testFile = `tests/unit/${f.replace('.js', '.test.js')}`;
    const hasTests = fs.existsSync(path.join(root, testFile));
    libs.push({
      file: relPath,
      windowExport: windowExports.length > 0 ? windowExports[0] : null,
      domain: classified.domain,
      confidence: classified.confidence,
      hasTests,
      testFile: hasTests ? testFile : null,
    });
  }

  // 4. Scanner public/components/*.jsx (seulement .jsx)
  const compDir = path.join(root, 'public/components');
  const compFiles = fs.existsSync(compDir)
    ? fs.readdirSync(compDir).filter(f => f.endsWith('.jsx')).sort()
    : [];

  /** @type {Array<{ file: string, componentName: string, windowExport: string|null, domain: string|null, confidence: string, hasTests: boolean, testFile: string|null }>} */
  const components = [];
  for (const f of compFiles) {
    const relPath = `public/components/${f}`;
    const content = readFileSafe(path.join(root, relPath)) || '';
    const windowExports = parseWindowExports(content);
    const baseName = f.replace('.jsx', '');
    const classified = classifyByKeywords(baseName, domains);
    const testFile = `tests/unit/${baseName}.test.js`;
    const hasTests = fs.existsSync(path.join(root, testFile));
    components.push({
      file: relPath,
      componentName: baseName,
      windowExport: windowExports.length > 0 ? windowExports[0] : null,
      domain: classified.domain,
      confidence: classified.confidence,
      hasTests,
      testFile: hasTests ? testFile : null,
    });
  }

  // 5. Scanner les Tab functions dans src/modules/**/*.jsx
  const tabPattern = /function ([A-Z][a-zA-Z]*Tab)\b/g;
  /** @type {Array<{ name: string, file: string, approxLine: number, domain: string|null, confidence: string }>} */
  const tabs = [];
  const seenTabs = new Set();
  for (const rel of walkFiles(root, 'src/modules', f => f.endsWith('.jsx'))) {
    const source = readFileSafe(path.join(root, rel)) || '';
    let tabMatch;
    tabPattern.lastIndex = 0;
    while ((tabMatch = tabPattern.exec(source)) !== null) {
      const name = tabMatch[1];
      if (seenTabs.has(name)) continue;
      seenTabs.add(name);
      const approxLine = source.slice(0, tabMatch.index).split('\n').length;
      const classified = classifyByKeywords(name, domains);
      tabs.push({ name, file: rel, approxLine, domain: classified.domain, confidence: classified.confidence });
    }
  }

  // 5b. Construire l'index des onglets
  const tabIndex = buildTabIndex(tabs);

  // 6. Scanner functions/index.js
  const cfSource = readFileSafe(path.join(root, 'functions/index.js')) || '';
  const cfExportNames = parseCFExports(cfSource);
  /** @type {Array<{ name: string, domain: string|null, confidence: string }>} */
  const cfExports = cfExportNames.map(name => {
    const classified = classifyByKeywords(name, domains);
    return { name, domain: classified.domain, confidence: classified.confidence };
  });

  // 7. Parser firebase.json
  const firebaseJsonContent = readFileSafe(path.join(root, 'firebase.json'));
  const firebaseJson = firebaseJsonContent ? JSON.parse(firebaseJsonContent) : {};
  const rewrites = parseFirebaseRewrites(firebaseJson);
  /** @type {Record<string, string>} */
  const routesIndex = {};
  for (const rw of rewrites) {
    routesIndex[rw.source] = rw.functionId;
  }

  // 8. Parser firestore.rules
  const rulesSource = readFileSafe(path.join(root, 'firestore.rules')) || '';
  const collectionNames = parseFirestoreCollections(rulesSource);
  /** @type {Array<{ name: string, domain: string|null, confidence: string }>} */
  const collections = collectionNames.map(name => {
    const classified = classifyByKeywords(name, domains);
    return { name, domain: classified.domain, confidence: classified.confidence };
  });

  // 9. Scanner functions/lib/
  const flDir = path.join(root, 'functions/lib');
  const flEntries = fs.existsSync(flDir) ? fs.readdirSync(flDir).sort() : [];
  /** @type {Array<{ name: string, isDir: boolean, domain: string|null, confidence: string, hasTests: boolean, testFiles: string[] }>} */
  const backendModules = [];
  for (const entry of flEntries) {
    const entryPath = path.join(flDir, entry);
    const isDir = fs.statSync(entryPath).isDirectory();
    const classified = classifyByKeywords(entry.replace('.js', ''), domains);
    // Vérifier si des tests existent
    let testFiles = /** @type {string[]} */ ([]);
    if (isDir) {
      const testsDir = path.join(flDir, entry, '__tests__');
      if (fs.existsSync(testsDir)) {
        const found = fs.readdirSync(testsDir)
          .filter(f => f.endsWith('.test.js'))
          .sort()
          .map(f => `functions/lib/${entry}/__tests__/${f}`);
        testFiles = found;
      }
    }
    backendModules.push({
      name: entry,
      isDir,
      domain: classified.domain,
      confidence: classified.confidence,
      hasTests: testFiles.length > 0,
      testFiles,
    });
  }

  // 9b. Scanner functions/*.js racine (services, hors index.js déjà scanné)
  const functionsRootDir = path.join(root, 'functions');
  const rootServiceFiles = fs.existsSync(functionsRootDir)
    ? fs.readdirSync(functionsRootDir)
        .filter(f => f.endsWith('.js') && f !== 'index.js')
        .sort()
    : [];

  for (const f of rootServiceFiles) {
    const baseName = f.replace('.js', '');
    const classified = classifyByKeywords(baseName, domains);
    const testFile = `tests/unit/${baseName}.test.js`;
    const hasTests = fs.existsSync(path.join(root, testFile));
    backendModules.push({
      name: f,
      filePath: `functions/${f}`,
      isDir: false,
      isRootService: true,
      domain: classified.domain,
      confidence: classified.confidence,
      hasTests,
      testFiles: hasTests ? [testFile] : [],
    });
  }

  // 10. Analyser git log pour heatmap et co-commits
  /** @type {Record<string, number>} */
  const fileCommitCount = {};
  /** @type {Record<string, Record<string, number>>} */
  const coCommitMatrix = {};

  try {
    const gitLog = execSync(
      'git log --format="%H" --name-only --diff-filter=M -n 200 --since="90 days ago"',
      { cwd: root, encoding: 'utf8' }
    );

    // Parser les blocs : un hash, puis des fichiers, séparés par lignes vides
    const blocks = gitLog.trim().split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 2) continue;
      // Première ligne = hash
      const filesInCommit = lines.slice(1).filter(l => l.trim() && !isExcludedFromGitCoupling(l.trim()));

      for (const f of filesInCommit) {
        fileCommitCount[f] = (fileCommitCount[f] || 0) + 1;
      }

      // Co-commits : toutes les paires
      for (let i = 0; i < filesInCommit.length; i++) {
        for (let j = i + 1; j < filesInCommit.length; j++) {
          const a = filesInCommit[i];
          const b = filesInCommit[j];
          if (!coCommitMatrix[a]) coCommitMatrix[a] = {};
          if (!coCommitMatrix[b]) coCommitMatrix[b] = {};
          coCommitMatrix[a][b] = (coCommitMatrix[a][b] || 0) + 1;
          coCommitMatrix[b][a] = (coCommitMatrix[b][a] || 0) + 1;
        }
      }
    }
  } catch (e) {
    console.warn('[DIL] Warning: git log indisponible, heatmap désactivée');
  }

  // Top 10 heatmap — tableau trié par count décroissant, puis alpha pour ex-aequo
  const heatmapEntries = Object.entries(fileCommitCount)
    .sort(([aPath, aCount], [bPath, bCount]) => {
      if (bCount !== aCount) return bCount - aCount;
      return aPath.localeCompare(bPath);
    })
    .slice(0, 10)
    .map(([file, commits]) => ({ file, commits }));

  // 11. Agréger par domaine
  /** @type {Record<string, any>} */
  const domainObjects = {};

  for (const [domainKey, domainDef] of Object.entries(domains)) {
    const domainTabs = tabs.filter(t => t.domain === domainKey).map(t => t.name).sort();
    const domainLibs = libs.filter(l => l.domain === domainKey);
    const domainComps = components.filter(c => c.domain === domainKey);
    const domainCFs = cfExports.filter(cf => cf.domain === domainKey).map(cf => cf.name).sort();
    const domainRoutes = rewrites
      .filter(rw => {
        const cfObj = cfExports.find(cf => cf.name === rw.functionId);
        return cfObj && cfObj.domain === domainKey;
      })
      .map(rw => ({ source: rw.source, functionId: rw.functionId }));
    const domainBEModules = backendModules.filter(m => m.domain === domainKey);
    const domainCollections = collections.filter(c => c.domain === domainKey).map(c => c.name).sort();

    // Tests
    const domainUnitTests = [
      ...domainLibs.filter(l => l.hasTests).map(l => l.testFile),
      ...domainComps.filter(c => c.hasTests).map(c => c.testFile),
    ].filter(/** @param {any} t */ t => t !== null).sort();

    const domainBackendTests = domainBEModules
      .flatMap(m => m.testFiles)
      .sort();

    // Coverage score
    const modulesForCoverage = domainLibs.length + domainComps.length + domainBEModules.length;
    const modulesWithTestsForCoverage = [
      ...domainLibs.filter(l => l.hasTests),
      ...domainComps.filter(c => c.hasTests),
      ...domainBEModules.filter(m => m.hasTests),
    ].length;
    const coverageScore = modulesForCoverage === 0 ? 0
      : Math.round(100 * modulesWithTestsForCoverage / modulesForCoverage);

    // Confidence globale du domaine
    const allItems = [
      ...domainLibs.map(l => l.confidence),
      ...domainComps.map(c => c.confidence),
    ];
    const domainConfidence = allItems.length > 0 && allItems.every(c => c === 'high') ? 'high' : 'medium';

    // Git coupling cross-domain
    const domainFiles = new Set([
      ...domainLibs.map(l => l.file),
      ...domainComps.map(c => c.file),
    ]);

    // Construire l'index domain → file pour les couplages
    const fileIndex = /** @type {Record<string, string|null>} */ ({});
    for (const l of libs) fileIndex[l.file] = l.domain;
    for (const c of components) fileIndex[c.file] = c.domain;

    /** @type {Array<{ file: string, coCommits: number, windowDays: number, domain: string|null, note: string }>} */
    const gitCoupling = [];
    const seenCoupled = new Set();
    for (const domFile of domainFiles) {
      const coCoupled = coCommitMatrix[domFile] || {};
      for (const [otherFile, count] of Object.entries(coCoupled)) {
        if (count < 3) continue;
        const otherDomain = fileIndex[otherFile] || null;
        if (otherDomain === domainKey) continue; // intra-domaine, exclure
        const key = `${domFile}::${otherFile}`;
        if (seenCoupled.has(key)) continue;
        seenCoupled.add(key);
        gitCoupling.push({
          file: otherFile,
          coCommits: count,
          windowDays: 90,
          domain: otherDomain,
          note: 'probabilistic',
        });
      }
    }
    gitCoupling.sort((a, b) => b.coCommits - a.coCommits || a.file.localeCompare(b.file));

    domainObjects[domainKey] = {
      label: domainDef.label,
      frontend: {
        tabs: domainTabs,
        libs: domainLibs.map(l => l.file).sort(),
        components: domainComps.map(c => c.file).sort(),
      },
      backend: {
        cloudFunctions: domainCFs,
        routes: domainRoutes,
        modules: domainBEModules.filter(m => !m.isRootService).map(m => m.name).sort(),
        services: domainBEModules.filter(m => m.isRootService).map(m => m.filePath).sort(),
      },
      firestore: {
        collections: domainCollections,
      },
      tests: {
        unit: domainUnitTests,
        backend: domainBackendTests,
      },
      coverageScore,
      confidence: domainConfidence,
      gitCoupling,
    };
  }

  // 12. Construire les index
  /** @type {Record<string, { domain: string|null, confidence: string }>} */
  const filesIndex = {};

  for (const l of libs) {
    filesIndex[l.file] = { domain: l.domain, confidence: l.confidence };
  }
  for (const c of components) {
    filesIndex[c.file] = { domain: c.domain, confidence: c.confidence };
  }
  for (const t of tabs) {
    filesIndex[`${t.file}#${t.name}`] = { domain: t.domain, confidence: t.confidence };
  }
  for (const cf of cfExports) {
    filesIndex[`functions/index.js#${cf.name}`] = { domain: cf.domain, confidence: cf.confidence };
  }
  for (const m of backendModules) {
    const fileKey = m.isRootService ? m.filePath : `functions/lib/${m.name}`;
    filesIndex[fileKey] = { domain: m.domain, confidence: m.confidence };
  }

  // Firestore collections index
  /** @type {Record<string, { domain: string|null, accessLevel: string }>} */
  const firestoreCollectionsIndex = {};
  for (const col of collections) {
    firestoreCollectionsIndex[col.name] = { domain: col.domain, accessLevel: 'CF-only' };
  }

  // Unclassified
  const unclassified = [];
  for (const [filePath, info] of Object.entries(filesIndex)) {
    if (info.domain === null) {
      unclassified.push({ file: filePath, confidence: info.confidence });
    }
  }
  unclassified.sort((a, b) => a.file.localeCompare(b.file));

  // 13. Calculer le healthScore
  const classifiedFiles = Object.values(filesIndex).filter(v => v.domain !== null).length;
  const totalFiles = Object.keys(filesIndex).length;
  const allModules = [...libs, ...components, ...backendModules];
  const modulesWithTests = allModules.filter(m => m.hasTests).length;
  const totalModules = allModules.length;

  const domainsWithFullStack = Object.values(domainObjects).filter(d => {
    const hasFrontend = d.frontend.tabs.length > 0 || d.frontend.libs.length > 0 || d.frontend.components.length > 0;
    const hasBackend = d.backend.cloudFunctions.length > 0 || d.backend.modules.length > 0;
    const hasFirestore = d.firestore.collections.length > 0;
    return hasFrontend && hasBackend && hasFirestore;
  }).length;
  const totalDomains = Object.keys(domains).length;

  const healthScore = computeHealthScore({
    classifiedFiles, totalFiles, modulesWithTests, totalModules,
    domainsWithFullStack, totalDomains,
  });

  // 14. Calculer le fingerprint
  const sourceFingerprint = computeFingerprint(fingerprintSources);

  // Statistiques
  const unitTestCount = libs.filter(l => l.hasTests).length
    + components.filter(c => c.hasTests).length;

  const totalModulesWithTests = modulesWithTests;
  const coverageScoreGlobal = totalModules === 0 ? 0
    : Math.round(100 * totalModulesWithTests / totalModules);

  // 15. Construire le _meta
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    sourceFingerprint,
    healthScore,
    stats: {
      domains: Object.keys(domains).length,
      tabFunctions: tabs.length,
      libHelpers: libs.length,
      extractedComponents: components.length,
      cloudFunctions: cfExports.length,
      firestoreCollections: collectionNames.length,
      backendModules: backendModules.length,
      unitTestFiles: unitTestCount,
      coverageScore: coverageScoreGlobal,
      unclassifiedFiles: unclassified.length,
      tabSymbols: Object.keys(tabIndex).length,
    },
    heatmap: heatmapEntries,
  };

  // 16. Construire et écrire le graphe
  const graph = {
    _meta: meta,
    domains: domainObjects,
    files: filesIndex,
    firestoreCollections: firestoreCollectionsIndex,
    tabIndex,
    routes: routesIndex,
    unclassified,
  };

  const sorted = sortKeysDeep(graph);

  // _meta doit rester en premier — reconstruire avec _meta en tête
  const output = Object.assign({ _meta: sortKeysDeep(meta) }, sorted);
  // sortKeysDeep a déjà mis _meta en place (tri alpha), on peut juste écrire sorted
  // (puisque _ vient avant les lettres en ASCII, _meta sera premier)

  const graphPath = outPath || path.join(root, 'docs/ai/module-graph.json');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(
    graphPath,
    JSON.stringify(sorted, null, 2) + '\n',
    'utf8'
  );

  console.log(`[DIL] module-graph.json généré`);
  console.log(`[DIL] Stats: ${tabs.length} tabs, ${libs.length} libs, ${components.length} composants, ${cfExports.length} CFs, ${collectionNames.length} collections`);
  console.log(`[DIL] HealthScore: ${healthScore.total}/100`);
  console.log(`[DIL] Fingerprint: ${sourceFingerprint}`);
}

// Support --fingerprint-only pour le pre-commit hook
if (process.argv.includes('--fingerprint-only')) {
  const root = path.resolve(__dirname, '..');
  const files = collectFingerprintSources(root);
  console.log(computeFingerprint(files));
  process.exit(0);
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  generateGraph(root).then(() => {
    console.log('DIL: module-graph.json généré');
  }).catch(err => {
    console.error('DIL scanner error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  normalizeForClassify,
  classifyByKeywords,
  parseWindowExports,
  parseCFExports,
  parseFirebaseRewrites,
  parseFirestoreCollections,
  computeFingerprint,
  collectFingerprintSources,
  isExcludedFromGitCoupling,
  computeHealthScore,
  buildTabIndex,
  walkFiles,
  sortKeysDeep,
  generateGraph,
};
