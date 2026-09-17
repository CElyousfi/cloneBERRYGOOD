/**
 * Ajoute un bouton URL "Ouvrir SmartBerry" à tous les templates existants.
 *
 * Usage:
 *   WA_TOKEN="EAA..." node add-url-buttons.js
 *
 * Variables d'environnement :
 *   WA_TOKEN   (obligatoire) Access Token Meta avec whatsapp_business_management
 *   WA_WABA_ID (optionnel)   WABA ID. Défaut: 1435674314903560
 *   WA_URL     (optionnel)   URL cible. Défaut: https://berrygood-farms-dashboard.web.app
 *   WA_BTN_TEXT (optionnel)  Texte du bouton. Défaut: "Ouvrir SmartBerry"
 *
 * Note: après modification, les templates passent en PENDING jusqu'à
 * approbation Meta (généralement 15-60 min).
 */

const token = process.env.WA_TOKEN;
const wabaId = process.env.WA_WABA_ID || "1435674314903560";
const buttonUrl = process.env.WA_URL || "https://berrygood-farms-dashboard.web.app";
const buttonText = process.env.WA_BTN_TEXT || "Ouvrir SmartBerry";

if (!token) {
  console.error("ERREUR: WA_TOKEN manquant");
  process.exit(1);
}

const TEMPLATE_NAMES = [
  "bdc_validation_needed",
  "bdc_chef_approved",
  "bdc_dg_approved",
  "bdc_rejected",
  "bdc_sent_to_supplier",
  "bdc_virement_update",
  "pointage_validation_needed",
  "quality_alert",
  "general_alert",
  "welcome_smartberry",
  "expedition_rejected",
];

async function listTemplates() {
  const r = await fetch(
    `https://graph.facebook.com/v22.0/${wabaId}/message_templates?fields=id,name,status,language,components&limit=200`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data.data || [];
}

async function updateTemplate(template) {
  // Find the BODY component to keep its text
  const bodyComp = (template.components || []).find(c => c.type === "BODY");
  if (!bodyComp || !bodyComp.text) {
    return { ok: false, error: "Pas de body trouvé" };
  }

  // Skip if already has a URL button
  const hasButton = (template.components || []).some(c =>
    c.type === "BUTTONS" && (c.buttons || []).some(b => b.type === "URL")
  );
  if (hasButton) {
    return { ok: true, skipped: true };
  }

  // Preserve existing example data
  const newBody = { type: "BODY", text: bodyComp.text };
  if (bodyComp.example) newBody.example = bodyComp.example;

  const components = [
    newBody,
    {
      type: "BUTTONS",
      buttons: [
        { type: "URL", text: buttonText, url: buttonUrl },
      ],
    },
  ];

  const r = await fetch(`https://graph.facebook.com/v22.0/${template.id}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ components }),
  });
  const data = await r.json();
  if (!r.ok) {
    return { ok: false, error: data.error?.message || JSON.stringify(data) };
  }
  return { ok: true, data };
}

(async () => {
  console.log(`\n🔘 Ajout du bouton "${buttonText}" → ${buttonUrl}\n`);

  let allTemplates;
  try {
    allTemplates = await listTemplates();
  } catch (err) {
    console.error("❌ Erreur listing:", err.message);
    process.exit(1);
  }

  const stats = { updated: 0, skipped: 0, failed: 0, notFound: 0 };

  for (const name of TEMPLATE_NAMES) {
    const matches = allTemplates.filter(t => t.name === name);
    if (matches.length === 0) {
      console.log(`  ▸ ${name.padEnd(32)} ⚠️  Introuvable`);
      stats.notFound++;
      continue;
    }
    // Some templates can have multiple language versions; update all
    for (const tpl of matches) {
      process.stdout.write(`  ▸ ${name.padEnd(32)} (${tpl.language}) `);
      const res = await updateTemplate(tpl);
      if (res.skipped) {
        console.log("⏭️  Bouton déjà présent");
        stats.skipped++;
      } else if (res.ok) {
        console.log("✅ Mis à jour (PENDING)");
        stats.updated++;
      } else {
        console.log(`❌ ${res.error}`);
        stats.failed++;
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n📊 Résumé:`);
  console.log(`   ✅ Mis à jour: ${stats.updated}`);
  console.log(`   ⏭️  Bouton déjà présent: ${stats.skipped}`);
  console.log(`   ❌ Échoués: ${stats.failed}`);
  console.log(`   ⚠️  Introuvables: ${stats.notFound}`);
  console.log(`\n👉 Statut visible sur:`);
  console.log(`   https://business.facebook.com/wa/manage/message-templates\n`);
  console.log(`⏱️  Approbation Meta: 15-60 min en général.`);
})();
