'use strict';
/**
 * diag-readonly.js — Outil de diagnostic STRICTEMENT lecture seule.
 *
 * Objectif : remplacer les scripts Node one-off écrits à la volée pour
 * inspecter Firestore / l'API Graph Meta (WhatsApp templates), qui
 * génèrent un ASK à chaque nouveau chemin de fichier. Ce script est
 * versionné, review-once, et n'expose QUE des actions read-only.
 *
 * GARDE-FOU : aucune méthode d'écriture Firestore (set/update/delete/add)
 * n'est appelée nulle part dans ce fichier. Aucun appel HTTP autre que GET.
 * Si un besoin d'écriture apparaît un jour, il doit passer par une Cloud
 * Function existante, jamais par ce script.
 *
 * GARDE-FOU SECRETS : tout champ dont le nom matche /token|secret|password|
 * api_key|private_key|credential/i est masqué (<MASKED>) avant impression,
 * pour les sorties firestore-get/firestore-query (cf. maskSensitive()).
 *
 * Usage :
 *   node scripts/diag-readonly.js firestore-get <collection> <docId>
 *   node scripts/diag-readonly.js firestore-query <collection> <field> <op> <value> [--limit N]
 *   node scripts/diag-readonly.js wa-templates [--name <name>]
 *
 * Exemples :
 *   node scripts/diag-readonly.js firestore-get config whatsapp
 *   node scripts/diag-readonly.js firestore-query purchase_orders numero "==" BDC-2026-0119
 *   node scripts/diag-readonly.js wa-templates --name bdc_chef_approved_doc
 */

// En local, l'ADC gcloud peut pointer vers un autre projet (ex: bgf-sentinel).
// Ce script cible toujours le projet Smart Berry, sauf override explicite.
if (!process.env.GCLOUD_PROJECT && !process.env.GOOGLE_CLOUD_PROJECT) {
  process.env.GCLOUD_PROJECT = 'berrygood-farms-dashboard';
}

const { db } = require('../functions/config/firebase');

const ALLOWED_OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'array-contains', 'in', 'array-contains-any']);

// Champs jamais affichés en clair (tokens/secrets Firestore) — masque-les avant impression.
const SENSITIVE_FIELD_RE = /token|secret|password|api_key|apikey|private_key|credential/i;

function maskSensitive(obj) {
  if (Array.isArray(obj)) return obj.map(maskSensitive);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = SENSITIVE_FIELD_RE.test(k) ? '<MASKED>' : maskSensitive(v);
    }
    return out;
  }
  return obj;
}

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') {
      flags.limit = Number(argv[++i]) || 20;
    } else if (argv[i] === '--name') {
      flags.name = argv[++i];
    } else {
      rest.push(argv[i]);
    }
  }
  return { flags, rest };
}

async function firestoreGet(collection, docId) {
  if (!collection || !docId) {
    throw new Error('Usage: firestore-get <collection> <docId>');
  }
  const snap = await db.collection(collection).doc(docId).get();
  if (!snap.exists) {
    console.log(`Document introuvable : ${collection}/${docId}`);
    return;
  }
  console.log(JSON.stringify(maskSensitive({ id: snap.id, ...snap.data() }), null, 2));
}

async function firestoreQuery(collection, field, op, value, limit) {
  if (!collection || !field || !op || value === undefined) {
    throw new Error('Usage: firestore-query <collection> <field> <op> <value> [--limit N]');
  }
  if (!ALLOWED_OPS.has(op)) {
    throw new Error(`Opérateur non supporté : ${op} (attendu: ${[...ALLOWED_OPS].join(', ')})`);
  }
  const numeric = Number(value);
  const typedValue = Number.isNaN(numeric) || value.trim() === '' ? value : numeric;
  const snap = await db.collection(collection).where(field, op, typedValue).limit(limit || 20).get();
  if (snap.empty) {
    console.log(`0 résultat pour ${collection} where ${field} ${op} ${value}`);
    return;
  }
  snap.forEach((doc) => {
    console.log(JSON.stringify(maskSensitive({ id: doc.id, ...doc.data() }), null, 2));
  });
}

async function waTemplates(nameFilter) {
  const doc = await db.collection('config').doc('whatsapp').get();
  const cfg = doc.exists ? doc.data() : {};
  const token = process.env.WA_TOKEN || cfg.access_token;
  const wabaId = process.env.WA_WABA_ID || cfg.waba_id || '1435674314903560';
  if (!token) throw new Error('Aucun access_token (config/whatsapp.access_token ou WA_TOKEN)');

  const r = await fetch(
    `https://graph.facebook.com/v22.0/${wabaId}/message_templates?fields=id,name,status,language,components&limit=200`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));

  const templates = data.data || [];
  const filtered = nameFilter ? templates.filter((t) => t.name === nameFilter) : templates;
  if (!filtered.length) {
    console.log(nameFilter ? `Template introuvable : ${nameFilter}` : 'Aucun template.');
    return;
  }
  filtered.forEach((t) => console.log(`${t.name} → status: ${t.status} (lang: ${t.language}, id: ${t.id})`));
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const { flags, rest } = parseFlags(argv);

  switch (command) {
    case 'firestore-get':
      await firestoreGet(rest[0], rest[1]);
      break;
    case 'firestore-query':
      await firestoreQuery(rest[0], rest[1], rest[2], rest[3], flags.limit);
      break;
    case 'wa-templates':
      await waTemplates(flags.name);
      break;
    default:
      console.error('Commande inconnue. Usage :');
      console.error('  node scripts/diag-readonly.js firestore-get <collection> <docId>');
      console.error('  node scripts/diag-readonly.js firestore-query <collection> <field> <op> <value> [--limit N]');
      console.error('  node scripts/diag-readonly.js wa-templates [--name <name>]');
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Erreur:', e.message);
    process.exit(1);
  });
