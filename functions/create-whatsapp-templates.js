/**
 * Crée tous les templates WhatsApp en une seule commande via l'API Meta.
 *
 * Usage:
 *   WA_TOKEN="EAA..." node create-whatsapp-templates.js
 *
 * Variables d'environnement :
 *   WA_TOKEN   (obligatoire) Access Token Meta avec permission whatsapp_business_management
 *   WA_WABA_ID (optionnel)   WABA ID. Défaut: 1435674314903560
 *   APP_ID     (obligatoire pour --upload-sample) ID de l'app Meta
 *   WA_SAMPLE_PDF_HANDLE  header_handle d'un PDF   (templates DOCUMENT « PDF »)
 *   WA_SAMPLE_XLSX_HANDLE header_handle d'un .xlsx (template campagne_rapport_hebdo)
 *   WA_SAMPLE_IMAGE_HANDLE header_handle d'une image (templates IMAGE)
 *
 * Note: les templates sont créés en statut "PENDING" et doivent être approuvés
 * par Meta (15 min à 24h). Vous pouvez vérifier leur statut sur :
 * https://business.facebook.com/wa/manage/message-templates
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOUMISSION DU TEMPLATE `campagne_rapport_hebdo` (header DOCUMENT .xlsx)
 * ─────────────────────────────────────────────────────────────────────────────
 * Meta EXIGE un `example.header_handle` pour un header média, et ce handle doit
 * porter le MIME réellement envoyé (ici un .xlsx, pas un PDF). Séquence exacte,
 * depuis `functions/` :
 *
 *   1) Fabriquer un classeur d'échantillon (ExcelJS, déjà une dépendance) :
 *        node create-whatsapp-templates.js --make-sample-xlsx /tmp/sample.xlsx
 *
 *   2) Obtenir le header_handle (Resumable Upload API) :
 *        APP_ID="<app_id>" WA_TOKEN="EAA..." \
 *          node create-whatsapp-templates.js --upload-sample /tmp/sample.xlsx
 *      → imprime le handle (`4::YXBwb...`).
 *
 *   3) Soumettre les templates (les existants sont sautés, seul le nouveau part) :
 *        WA_TOKEN="EAA..." WA_SAMPLE_XLSX_HANDLE="<handle de l'étape 2>" \
 *          node create-whatsapp-templates.js
 *
 * ⚠️ Acte EXTERNE et visible par Meta (+ 1 seule édition par 24 h) : ne rien
 * soumettre sans GO explicite d'Omar.
 */

const token = process.env.WA_TOKEN;
const wabaId = process.env.WA_WABA_ID || "1435674314903560";

// --- CLI one-shot : fabrication d'un classeur d'échantillon (pas de token requis)
const argv = process.argv.slice(2);
const makeSampleIdx = argv.indexOf("--make-sample-xlsx");
if (makeSampleIdx !== -1) {
  const outPath = argv[makeSampleIdx + 1] || "./sample.xlsx";
  makeSampleXlsx(outPath)
    .then((p) => { console.log(`✅ Échantillon .xlsx écrit : ${p}`); })
    .catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
  return;
}

if (!token) {
  console.error("ERREUR: variable WA_TOKEN manquante");
  console.error('Usage: WA_TOKEN="EAA..." node create-whatsapp-templates.js');
  process.exit(1);
}

// --- CLI one-shot : upload d'un échantillon → header_handle (token + APP_ID requis)
const uploadSampleIdx = argv.indexOf("--upload-sample");
if (uploadSampleIdx !== -1) {
  const filePath = argv[uploadSampleIdx + 1];
  uploadSampleMedia(filePath)
    .then((handle) => {
      console.log(`✅ header_handle : ${handle}`);
      console.log(`   → relancer avec WA_SAMPLE_XLSX_HANDLE="${handle}" (ou _PDF_/_IMAGE_ selon le type)`);
    })
    .catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
  return;
}

const TEMPLATES = [
  {
    name: "bdc_validation_needed_v2",
    body: "Bonjour, BDC {{1}} en attente de votre validation.\nFournisseur : {{2}}\nMontant : {{3}}\nArticles : {{4}}\n\nRépondez *OK* pour valider, *NON* pour rejeter.",
    examples: ["BDC-2026-0042", "AGRIDATA", "45000 MAD", "Engrais NPK ×100 kg, Topas ×20 L"],
  },
  {
    name: "bdc_validation_needed_doc",
    body: "Bonjour, BDC {{1}} en attente de votre validation.\nFournisseur : {{2}}\nMontant : {{3}}\nArticles : {{4}}\nPDF en pièce jointe.\n\nRépondez *OK* pour valider, *NON* pour rejeter.",
    examples: ["BDC-2026-0042", "AGRIDATA", "45000 MAD", "Engrais NPK ×100 kg, Topas ×20 L"],
    headerType: "DOCUMENT",
  },
  {
    name: "bdc_chef_approved",
    body: "Le BDC {{1}} a été approuvé par le Chef. En attente de validation DG.",
    examples: ["BDC-2026-0042"],
  },
  {
    name: "bdc_chef_approved_doc",
    body: "Le BDC {{1}} a été approuvé par le Chef. En attente de votre validation DG.\nPDF en pièce jointe.\n\nRépondez *OK* pour valider, *NON* pour rejeter.",
    examples: ["BDC-2026-0042"],
    headerType: "DOCUMENT",
  },
  {
    name: "bdc_dg_approved",
    body: "Le BDC {{1}} ({{2}}, {{3}}) a été approuvé par le DG. Prêt pour envoi fournisseur.",
    examples: ["BDC-2026-0042", "Engrais NPK", "45000 MAD"],
  },
  {
    name: "bdc_rejected",
    body: "Le BDC {{1}} a été rejeté. Motif : {{2}}. Veuillez consulter le tableau de bord SmartBerry.",
    examples: ["BDC-2026-0042", "Prix trop élevé"],
  },
  {
    name: "bdc_sent_to_supplier",
    body: "Le BDC {{1}} a été envoyé au fournisseur {{2}} par email. Le virement peut être lancé.",
    examples: ["BDC-2026-0042", "Maroc Engrais SARL"],
  },
  {
    name: "bdc_virement_update",
    body: "Mise à jour virement BDC {{1}} : {{2}}. Veuillez consulter le tableau de bord SmartBerry.",
    examples: ["BDC-2026-0042", "Virement signé"],
  },
  {
    name: "pointage_validation_needed",
    body: "Pointage du {{1}} ferme {{2}} en attente de votre validation.",
    examples: ["2026-05-01", "BSAA"],
  },
  {
    name: "quality_alert",
    body: "Alerte qualité SmartBerry : {{1}}. Veuillez consulter le tableau de bord.",
    examples: ["Expédition manquante détectée le 2026-05-01"],
  },
  {
    name: "general_alert",
    body: "SmartBerry — Notification : {{1}}. Consultez votre tableau de bord pour plus de détails.",
    examples: ["Nouvelle alerte sur le tableau de bord"],
  },
  {
    name: "welcome_smartberry",
    body: "Cher(e) {{1}}, au nom de toute l'équipe SmartBerry, nous avons le plaisir de vous informer que vous êtes désormais inscrit(e) au service WhatsApp. Vous recevrez dorénavant les alertes et demandes de validation directement sur ce numéro.",
    examples: ["Mohamed"],
  },
  {
    name: "expedition_rejected",
    body: "Rejet d'expédition Driscoll's : Receipt {{1}} le {{2}}. Variété {{3}}, ferme {{4}}, volume {{5}} kg. Motif principal : {{6}}. Veuillez consulter SmartBerry pour le détail.",
    examples: ["RPT-2026-0123", "01/05/2026 14:30", "Sweet Sensation", "BSAA", "1250", "Soft fruit"],
  },
  {
    name: "expedition_rejected_doc",
    body: "Rejet d'expédition Driscoll's : Receipt {{1}} le {{2}}. Variété {{3}}, ferme {{4}}, volume {{5}} kg. Motif principal : {{6}}. PDF d'inspection en pièce jointe.",
    examples: ["RPT-2026-0123", "01/05/2026 14:30", "Sweet Sensation", "BSAA", "1250", "Soft fruit"],
    headerType: "DOCUMENT",
  },
  {
    name: "bdc_reminder",
    body: "Rappel SmartBerry : le BDC {{1}} d'un montant de {{2}} est en attente de votre validation depuis {{3}}. Merci de le traiter rapidement.",
    examples: ["BDC-2026-0042", "45000 MAD", "2 jours"],
  },
  {
    name: "sentinel_intrusion_img",
    headerType: "IMAGE",
    body: "🚨 Alerte intrusion — {{1}}\n📷 Caméra : {{2}}\n🕐 Heure : {{3}}\nPersonne détectée la nuit. Vérifiez le dashboard Sentinel.",
    // ordre : {{1}}=ferme, {{2}}=caméra, {{3}}=heure
    examples: ["F5", "Entrée Nord", "02:14"],
  },
  {
    name: "production_digest_dg",
    body: "SmartBerry — Production {{1}}\n\n{{2}}",
    examples: [
      "17/05",
      "🎯 Estimation Cycle 2\n🍇 Framboise\n• Maravilla Green Cane — 9.37 T/Ha (Budget 72%, Local 12.0%, Export 37.47 T)\n🫐 Myrtille\n• Corina — 3.48 Kg/Pl (Budget 87%, Local 2.8%, Export 28.72 T)",
    ],
  },
  {
    // Digest météo & traitements (6h) — DG + chef F1 + chef F5. L'exemple DOIT
    // être multi-ligne et riche : c'est son absence qui a fait rejeter le body
    // réel de `production_digest_dg` avec l'erreur #132018.
    name: "meteo_spray_digest",
    body: "SmartBerry — Météo & Traitements {{1}}\n\n{{2}}",
    examples: [
      "Jeu 14/08",
      "🌡️ Température : 17°C → 29°C\n💨 Vent max : 12 km/h\n🌧️ Pluie : 0 mm\n\n✅ Fenêtres de traitement :\n• 06h00 - 09h00\n• 18h00 - 20h00\nScore du jour : 62% favorable",
    ],
  },
  {
    // Alertes météo à 7 jours (Forte Chaleur / Vent Fort / Forte Pluie) — même
    // audience que le digest. Message groupé : {{1}} = période couverte,
    // {{2}} = corps multi-ligne (une section par alerte). Comme
    // `meteo_spray_digest`, l'exemple DOIT être multi-ligne et riche : c'est son
    // absence qui a fait rejeter `production_digest_dg` avec l'erreur #132018.
    name: "meteo_alerte_7j",
    body: "SmartBerry — Alerte météo {{1}}\n\n{{2}}",
    examples: [
      "21 → 24/08",
      "VENDREDI 21 AOÛT — FORTE CHALEUR\n🌡️ 34°C prévus (seuil 32°C)\n\nSAMEDI 22 AOÛT — FORTE PLUIE\n🌧️ 18.4 mm prévus (seuil 10 mm)\n\nLUNDI 24 AOÛT — VENT FORT\n💨 31 km/h prévus (seuil 25 km/h)\n\n⚠️ Reporter les traitements phyto sur ces journées et prévoir les protections adaptées.",
    ],
  },
  {
    // Rapport Campagne hebdomadaire (lundi 16h) — le classeur .xlsx voyage dans
    // le header DOCUMENT. Template DÉDIÉ : les templates DOCUMENT existants
    // annoncent un PDF dans leur corps, et Meta ne tolère qu'une édition par
    // 24 h — les réutiliser serait un aller sans retour.
    name: "campagne_rapport_hebdo",
    body: "SmartBerry — Rapport Campagne {{1}} du {{2}}. {{3}} parcelles. Le fichier Excel est en pièce jointe.",
    examples: ["Framboise", "18/08/2026", "23"],
    headerType: "DOCUMENT",
    // Le handle d'échantillon doit être un .xlsx, pas le PDF par défaut.
    sampleHandleEnv: "WA_SAMPLE_XLSX_HANDLE",
  },
];

async function createTemplate(tpl) {
  const components = [];
  if (tpl.headerType === "DOCUMENT") {
    // Meta requires a sample handle for media headers. Provide one via WA_SAMPLE_PDF_HANDLE
    // (obtained from the resumable upload API) — ou via la variable déclarée par le template
    // lui-même (`sampleHandleEnv`) quand le document n'est pas un PDF (cf. .xlsx du rapport
    // Campagne : le handle doit porter le MIME réellement envoyé). If absent, submit without —
    // Meta may still approve UTILITY templates without a sample, otherwise fall back to manual
    // creation.
    const headerComponent = { type: "HEADER", format: "DOCUMENT" };
    const handle = process.env[tpl.sampleHandleEnv || "WA_SAMPLE_PDF_HANDLE"];
    if (handle) {
      headerComponent.example = { header_handle: [handle] };
    }
    components.push(headerComponent);
  } else if (tpl.headerType === "IMAGE") {
    // Meta requires a sample handle for media headers. Provide one via WA_SAMPLE_IMAGE_HANDLE
    // (obtained from the resumable upload API, cf. uploadSampleMedia ci-dessous). If absent,
    // submit without — Meta REJETTERA probablement le template image sans sample ; il faudra
    // alors fournir WA_SAMPLE_IMAGE_HANDLE.
    const headerComponent = { type: "HEADER", format: "IMAGE" };
    if (process.env.WA_SAMPLE_IMAGE_HANDLE) {
      headerComponent.example = { header_handle: [process.env.WA_SAMPLE_IMAGE_HANDLE] };
    }
    components.push(headerComponent);
  }
  components.push({
    type: "BODY",
    text: tpl.body,
    ...(tpl.examples.length > 0 ? {
      example: { body_text: [tpl.examples] },
    } : {}),
  });

  const payload = {
    name: tpl.name,
    language: "fr",
    category: "UTILITY",
    components,
  };

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}/message_templates`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

async function listExistingTemplates() {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/message_templates?fields=name,status&limit=200`,
      { headers: { "Authorization": `Bearer ${token}` } }
    );
    const data = await response.json();
    if (!response.ok) return new Map();
    const map = new Map();
    (data.data || []).forEach(t => map.set(t.name, t.status));
    return map;
  } catch (e) {
    return new Map();
  }
}

/** MIME par extension, pour l'échantillon uploadé à Meta. */
const SAMPLE_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Fabrique un classeur .xlsx minimal utilisable comme échantillon de header
 * DOCUMENT. Meta n'en lit que le type — un contenu factice suffit, et on évite
 * ainsi de faire transiter un vrai rapport d'exploitation.
 *
 * Usage : node create-whatsapp-templates.js --make-sample-xlsx /tmp/sample.xlsx
 *
 * @param {string} outPath
 * @returns {Promise<string>} chemin écrit
 */
async function makeSampleXlsx(outPath) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Synthèse");
  ws.addRow(["SmartBerry — échantillon de template WhatsApp"]);
  ws.addRow(["Parcelle", "JH", "JH / Ha"]);
  ws.addRow(["EXEMPLE", 12, 3.4]);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

/**
 * Utilitaire OPTIONNEL — obtient un `header_handle` pour un header média (IMAGE
 * ou DOCUMENT : pdf, xlsx) via la Resumable Upload API de Meta. NON appelé
 * automatiquement dans le flow principal : le handle reste fourni à
 * createTemplate() via une variable d'env (WA_SAMPLE_IMAGE_HANDLE,
 * WA_SAMPLE_PDF_HANDLE, WA_SAMPLE_XLSX_HANDLE).
 *
 * Prérequis :
 *   - APP_ID    : ID de l'app Meta (process.env.APP_ID)
 *   - WA_TOKEN  : déjà requis par ce script
 *   - filePath  : chemin local vers l'échantillon (jpg/png/pdf/xlsx)
 *
 * Usage manuel (one-shot) :
 *   APP_ID="..." WA_TOKEN="EAA..." node create-whatsapp-templates.js --upload-sample /tmp/sample.xlsx
 *   // puis : WA_SAMPLE_XLSX_HANDLE="<handle>" node create-whatsapp-templates.js
 *
 * Étapes (cf. https://developers.facebook.com/docs/graph-api/guides/upload) :
 *   1) POST /{APP_ID}/uploads  -> ouvre une session, renvoie un upload id ("upload:...")
 *   2) POST /{sessionId}       avec le fichier en body -> renvoie { h: "<header_handle>" }
 *
 * @param {string} filePath
 * @param {string} [mimeOverride]
 * @returns {Promise<string>} header_handle
 */
async function uploadSampleMedia(filePath, mimeOverride) {
  const fs = require("fs");
  const path = require("path");
  const appId = process.env.APP_ID;
  if (!appId) throw new Error("APP_ID manquant (variable d'env)");
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Fichier introuvable: ${filePath}`);

  const fileBuffer = fs.readFileSync(filePath);
  const fileLength = fileBuffer.length;
  const ext = path.extname(filePath).toLowerCase();
  const fileType = mimeOverride || SAMPLE_MIME_BY_EXT[ext];
  if (!fileType) throw new Error(`Extension non supportée: ${ext} (attendu: ${Object.keys(SAMPLE_MIME_BY_EXT).join(", ")})`);

  // 1) Ouvrir une session d'upload
  const startUrl = `https://graph.facebook.com/v21.0/${appId}/uploads`
    + `?file_length=${fileLength}&file_type=${encodeURIComponent(fileType)}`;
  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
  });
  const startData = await startRes.json();
  if (!startRes.ok || !startData.id) {
    throw new Error(`Ouverture session échouée: ${startData.error?.message || JSON.stringify(startData)}`);
  }
  const sessionId = startData.id; // ex. "upload:XXXX"

  // 2) Uploader le fichier (offset 0, fichier en une seule passe)
  const uploadRes = await fetch(`https://graph.facebook.com/v21.0/${sessionId}`, {
    method: "POST",
    headers: {
      "Authorization": `OAuth ${token}`,
      "file_offset": "0",
      "Content-Type": "application/octet-stream",
    },
    body: fileBuffer,
  });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.h) {
    throw new Error(`Upload fichier échoué: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
  }
  return uploadData.h; // header_handle
}

(async () => {
  console.log(`\n🔍 Vérification des templates existants...`);
  const existing = await listExistingTemplates();
  console.log(`   ${existing.size} templates déjà présents sur WABA ${wabaId}\n`);

  console.log(`🚀 Création/mise à jour de ${TEMPLATES.length} templates\n`);

  const results = { success: 0, exists: 0, failed: 0 };

  for (const tpl of TEMPLATES) {
    if (existing.has(tpl.name)) {
      console.log(`  ▸ ${tpl.name.padEnd(32)} ⏭️  Déjà présent (${existing.get(tpl.name)})`);
      results.exists++;
      continue;
    }
    process.stdout.write(`  ▸ ${tpl.name.padEnd(32)} `);
    try {
      const { ok, data } = await createTemplate(tpl);
      if (ok) {
        console.log(`✅ Créé (status: ${data.status || "PENDING"}, id: ${data.id})`);
        results.success++;
      } else if (data.error?.error_subcode === 2388023 || data.error?.message?.includes("already exists")) {
        console.log(`⚠️  Existe déjà`);
        results.exists++;
      } else {
        console.log(`❌ Échec`);
        console.log(`     → ${data.error?.message || JSON.stringify(data)}`);
        if (data.error?.error_user_msg) console.log(`     → ${data.error.error_user_msg}`);
        results.failed++;
      }
    } catch (err) {
      console.log(`❌ Erreur réseau: ${err.message}`);
      results.failed++;
    }
    // Petit délai pour éviter rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n📊 Résumé:`);
  console.log(`   ✅ Créés: ${results.success}`);
  console.log(`   ⚠️  Existaient déjà: ${results.exists}`);
  console.log(`   ❌ Échoués: ${results.failed}`);
  console.log(`\n👉 Statut d'approbation visible sur:`);
  console.log(`   https://business.facebook.com/wa/manage/message-templates\n`);
})();
