'use strict';
/**
 * Audit des permissions Claude Code — projet Smart Berry uniquement.
 *
 * Contraintes de confidentialité (NON NÉGOCIABLES) :
 *   - Lit UNIQUEMENT les transcripts du répertoire de ce projet.
 *   - Ne lit JAMAIS ~/.claude/projects d'un autre projet.
 *   - Ne copie aucun transcript dans le dépôt.
 *   - Ne restitue jamais le contenu brut des prompts ou sorties.
 *   - Masque : chemins personnels (/Users/…), URLs, tokens (≥40 chars),
 *     valeurs de variables d'env (VAR=<masqué>).
 *   - Produit uniquement : statistiques et commandes normalisées.
 *
 * Usage : node scripts/permission-audit.js
 */

const fs = require('fs');
const path = require('path');

// Répertoire des transcripts, limité à ce projet Smart Berry.
const PROJECT_TRANSCRIPT_DIR = path.join(
  process.env.HOME || '/tmp',
  '.claude',
  'projects',
  '-Users-omarmaaouni-Desktop-DESKTOP--OLD--berrygood-dashboard'
);

// Masque les données sensibles dans une chaîne.
function mask(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\/Users\/\S+/g, '<PATH>')
    .replace(/https?:\/\/[^\s"',)\]]+/g, '<URL>')
    .replace(/\b[A-Za-z0-9+/]{40,}\b/g, '<TOKEN>')
    .replace(/([A-Z][A-Z0-9_]+=)[^\s"',)\]]+/g, '$1<VALUE>');
}

// Normalise une commande Bash : masque les données sensibles et ne conserve
// que le verbe de commande (+ sous-commande pour git/npm/firebase).
function normalizeCmd(raw) {
  if (!raw || typeof raw !== 'string') return '[vide]';
  const safe = mask(raw).trim();
  const parts = safe.split(/\s+/);
  const cmd0 = parts[0] || '';
  if (['git', 'npm', 'firebase', 'gcloud', 'node', 'python3'].includes(cmd0) && parts[1]) {
    return `${cmd0} ${parts[1]}`;
  }
  return cmd0 || '[vide]';
}

// Vérifie que le chemin est bien dans PROJECT_TRANSCRIPT_DIR (protection traversal).
function isSafeTranscriptFile(filePath) {
  const resolved = path.resolve(filePath);
  const base = path.resolve(PROJECT_TRANSCRIPT_DIR);
  return resolved.startsWith(base + path.sep) && resolved.endsWith('.jsonl');
}

function listTranscripts() {
  if (!fs.existsSync(PROJECT_TRANSCRIPT_DIR)) {
    console.error('Répertoire de transcripts introuvable. Script annulé.');
    console.error('(Chemin attendu masqué pour confidentialité)');
    process.exit(1);
  }
  return fs.readdirSync(PROJECT_TRANSCRIPT_DIR)
    .map(f => path.join(PROJECT_TRANSCRIPT_DIR, f))
    .filter(isSafeTranscriptFile);
}

function audit() {
  const files = listTranscripts();
  const cmdCounts = {};
  const toolCounts = {};
  let totalMessages = 0;
  let totalToolUses = 0;
  let totalBashUses = 0;

  for (const file of files) {
    let lines;
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    } catch (e) {
      // Ne pas exposer le chemin ni l'erreur brute.
      console.error('Erreur de lecture d\'un fichier transcript (détail masqué).');
      continue;
    }

    for (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      totalMessages++;

      // On extrait uniquement les tool_use de type Bash dans les messages assistant.
      const content = entry.message?.content || entry.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        totalToolUses++;

        const toolName = block.name || '[inconnu]';
        toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;

        if (toolName !== 'Bash') continue;
        totalBashUses++;

        const normalized = normalizeCmd(block.input?.command || '');
        cmdCounts[normalized] = (cmdCounts[normalized] || 0) + 1;
      }
    }
  }

  // Affichage des résultats (aucune donnée brute, aucun chemin, aucun token).
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  Audit Permissions — Smart Berry (résumé)   ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Transcripts analysés : ${files.length}`);
  console.log(`  Messages lus         : ${totalMessages}`);
  console.log(`  Tool uses totaux     : ${totalToolUses}`);
  console.log(`  Bash uses            : ${totalBashUses}`);

  if (Object.keys(toolCounts).length > 0) {
    console.log('\n  Répartition par outil :');
    for (const [t, n] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(5)}×  ${t}`);
    }
  }

  const sorted = Object.entries(cmdCounts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    console.log('\n  Commandes Bash (normalisées, top 30) :');
    for (const [cmd, n] of sorted.slice(0, 30)) {
      console.log(`    ${String(n).padStart(5)}×  ${cmd}`);
    }
    if (sorted.length > 30) {
      console.log(`    … et ${sorted.length - 30} autres commandes distinctes.`);
    }
  }

  console.log('\n  ⚠ Aucune donnée brute, chemin personnel, URL ou token n\'est exposée.');
  console.log('  ⚠ Aucun transcript n\'a été copié dans le dépôt.\n');
}

audit();
