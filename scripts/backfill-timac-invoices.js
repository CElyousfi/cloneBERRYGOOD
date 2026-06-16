#!/usr/bin/env node
'use strict';

/**
 * backfill-timac-invoices.js — Rejoue les factures TIMAC historiques (PDF)
 * dans le module Achats, en passant par EXACTEMENT le même helper que la cron
 * email (createTimacInvoiceFromParsed) → idempotence garantie backfill↔cron.
 *
 * DRY-RUN PAR DÉFAUT. Écriture réelle UNIQUEMENT avec --apply explicite.
 *
 * Usage (depuis n'importe quel cwd — chemins absolus gérés en interne) :
 *   # dry-run (par défaut, n'écrit RIEN) :
 *   node scripts/backfill-timac-invoices.js
 *   node scripts/backfill-timac-invoices.js --dir=/chemin/vers/PDF
 *
 *   # écriture réelle (GATED — lancé par l'architecte après validation) :
 *   node scripts/backfill-timac-invoices.js --apply
 *
 * Pré-requis écriture : ADC (Application Default Credentials) Firebase.
 *
 * Idempotence :
 *   - INTER-RUN : garde via invoices.where('numero_facture','==',...) dans le helper.
 *   - INTRA-RUN : Set des num_facture déjà traités dans ce run (2 fichiers même num
 *     → traité une seule fois).
 */

const fs = require('fs');
const path = require('path');

// --- Arguments ---
const ARGV = process.argv.slice(2);
const APPLY = ARGV.includes('--apply');
const dirArg = ARGV.find((a) => a.startsWith('--dir='));
const DEFAULT_DIR =
  '/Users/omarmaaouni/Desktop/berrygood-dashboard/docs/factures/TIMAC';
const PDF_DIR = dirArg ? path.resolve(dirArg.slice('--dir='.length)) : DEFAULT_DIR;

// --- Firebase Admin : initialiser AVANT de require emailService.js ---
// (emailService.js appelle admin.firestore() et admin.storage() au chargement ;
//  l'app par défaut doit être initialisée d'abord — même instance partagée.)
process.env.GOOGLE_CLOUD_PROJECT =
  process.env.GOOGLE_CLOUD_PROJECT || 'berrygood-farms-dashboard';

const FUNCTIONS_DIR = path.resolve(__dirname, '..', 'functions');
const admin = require(path.join(FUNCTIONS_DIR, 'node_modules', 'firebase-admin'));

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'berrygood-farms-dashboard',
    // En dry-run la lecture Firestore (check idempotence) nécessite quand même ADC.
    credential: admin.credential.applicationDefault(),
    storageBucket: 'berrygood-farms-photos',
  });
}

// --- Charger le helper + le parser depuis functions/ (chemins absolus) ---
const {
  parseTimacInvoicePdf,
  createTimacInvoiceFromParsed,
} = require(path.join(FUNCTIONS_DIR, 'emailService.js'));

// --- Helpers d'affichage ---
function pad(s, n) {
  s = s == null ? '' : String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function fmtNum(v) {
  if (v == null) return '';
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUT_LABEL = {
  would_create: 'NEW',
  created: 'CREATED',
  skipped: 'SKIP-existe-déjà',
  a_revoir: 'A-REVOIR-num-absent',
  dup_intra_run: 'SKIP-doublon-intra-run',
};

async function main() {
  console.log('========================================================');
  console.log('  BACKFILL FACTURES TIMAC');
  console.log('  Mode   :', APPLY ? 'APPLY (écriture réelle)' : 'DRY-RUN (aucune écriture)');
  console.log('  Dossier:', PDF_DIR);
  console.log('========================================================\n');

  if (!fs.existsSync(PDF_DIR)) {
    console.error(`ERREUR: dossier introuvable: ${PDF_DIR}`);
    console.error('Passe --dir=<chemin> pour cibler un autre dossier.');
    process.exit(1);
  }

  const files = fs
    .readdirSync(PDF_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();

  if (files.length === 0) {
    console.error(`ERREUR: aucun PDF dans ${PDF_DIR}`);
    process.exit(1);
  }

  console.log(`${files.length} fichier(s) PDF trouvé(s).\n`);

  const seenNumFacture = new Set();
  const rows = [];
  const recap = { NEW: 0, CREATED: 0, SKIP_existant: 0, SKIP_dup: 0, A_REVOIR: 0, ERREUR: 0 };

  for (const filename of files) {
    const fullPath = path.join(PDF_DIR, filename);
    let parsed;
    try {
      const buf = fs.readFileSync(fullPath);
      parsed = await parseTimacInvoicePdf(buf);

      // Idempotence INTRA-RUN : deux fichiers même num_facture → 1 seule fois.
      if (parsed && parsed.num_facture && seenNumFacture.has(parsed.num_facture)) {
        rows.push({
          filename,
          num_facture: parsed.num_facture,
          date: parsed.date_facture,
          fournisseur: parsed.fournisseur,
          total_ttc: parsed.net_a_payer,
          nb_lignes: (parsed.lignes || []).length,
          statut: STATUT_LABEL.dup_intra_run,
        });
        recap.SKIP_dup++;
        continue;
      }

      const res = await createTimacInvoiceFromParsed(parsed, {
        pdfBuffer: buf,
        filename,
        source: 'backfill_timac',
        dryRun: !APPLY,
      });

      if (parsed && parsed.num_facture) seenNumFacture.add(parsed.num_facture);

      const statut = STATUT_LABEL[res.status] || res.status;
      rows.push({
        filename,
        num_facture: parsed && parsed.num_facture,
        date: parsed && parsed.date_facture,
        fournisseur: parsed && parsed.fournisseur,
        total_ttc: parsed && parsed.net_a_payer,
        nb_lignes: (parsed && parsed.lignes ? parsed.lignes.length : 0),
        statut,
        numero: res.numero || res.existing_numero || null,
      });

      if (res.status === 'would_create') recap.NEW++;
      else if (res.status === 'created') recap.CREATED++;
      else if (res.status === 'skipped') recap.SKIP_existant++;
      else if (res.status === 'a_revoir') recap.A_REVOIR++;
    } catch (err) {
      rows.push({
        filename,
        num_facture: parsed && parsed.num_facture,
        statut: 'ERREUR: ' + err.message,
      });
      recap.ERREUR++;
    }
  }

  // --- Tableau ---
  console.log(
    pad('FICHIER', 32) + pad('NUM_FAC', 12) + pad('DATE', 12) +
    pad('FOURNISSEUR', 20) + pad('TOTAL_TTC', 14) + pad('LIG', 5) + 'STATUT'
  );
  console.log('-'.repeat(120));
  for (const r of rows) {
    console.log(
      pad(r.filename, 32) +
      pad(r.num_facture, 12) +
      pad(r.date, 12) +
      pad(r.fournisseur, 20) +
      pad(fmtNum(r.total_ttc), 14) +
      pad(r.nb_lignes != null ? String(r.nb_lignes) : '', 5) +
      (r.statut + (r.numero ? ' (' + r.numero + ')' : ''))
    );
  }

  // --- Récap ---
  console.log('\n========================================================');
  console.log('  RÉCAP');
  if (APPLY) {
    console.log(`  CREATED (créées)        : ${recap.CREATED}`);
  } else {
    console.log(`  NEW (would_create)      : ${recap.NEW}`);
  }
  console.log(`  SKIP existant (cron/DB) : ${recap.SKIP_existant}`);
  console.log(`  SKIP doublon intra-run  : ${recap.SKIP_dup}`);
  console.log(`  A-REVOIR (num absent)   : ${recap.A_REVOIR}`);
  if (recap.ERREUR) console.log(`  ERREUR (parsing/IO)     : ${recap.ERREUR}`);
  console.log(`  TOTAL fichiers          : ${files.length}`);
  console.log('========================================================');
  if (!APPLY) {
    console.log('\nDRY-RUN : aucune écriture effectuée. Relancer avec --apply pour créer.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill ÉCHEC:', err);
    process.exit(1);
  });
