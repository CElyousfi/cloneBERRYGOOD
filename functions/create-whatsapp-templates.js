/**
 * Crée tous les templates WhatsApp en une seule commande via l'API Meta.
 *
 * Usage:
 *   WA_TOKEN="EAA..." node create-whatsapp-templates.js
 *
 * Variables d'environnement :
 *   WA_TOKEN   (obligatoire) Access Token Meta avec permission whatsapp_business_management
 *   WA_WABA_ID (optionnel)   WABA ID. Défaut: 1435674314903560
 *
 * Note: les templates sont créés en statut "PENDING" et doivent être approuvés
 * par Meta (15 min à 24h). Vous pouvez vérifier leur statut sur :
 * https://business.facebook.com/wa/manage/message-templates
 */

const token = process.env.WA_TOKEN;
const wabaId = process.env.WA_WABA_ID || "1435674314903560";

if (!token) {
  console.error("ERREUR: variable WA_TOKEN manquante");
  console.error('Usage: WA_TOKEN="EAA..." node create-whatsapp-templates.js');
  process.exit(1);
}

const TEMPLATES = [
  {
    name: "bdc_validation_needed",
    body: "Bonjour, le BDC {{1}} ({{2}}) d'un montant de {{3}} est en attente de votre validation.",
    examples: ["BDC-2026-0042", "Engrais NPK", "45000 MAD"],
  },
  {
    name: "bdc_chef_approved",
    body: "Le BDC {{1}} a été approuvé par le Chef. En attente de validation DG.",
    examples: ["BDC-2026-0042"],
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
    name: "bdc_reminder",
    body: "Rappel SmartBerry : le BDC {{1}} d'un montant de {{2}} est en attente de votre validation depuis {{3}}. Merci de le traiter rapidement.",
    examples: ["BDC-2026-0042", "45000 MAD", "2 jours"],
  },
];

async function createTemplate(tpl) {
  const payload = {
    name: tpl.name,
    language: "fr",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: tpl.body,
        ...(tpl.examples.length > 0 ? {
          example: { body_text: [tpl.examples] },
        } : {}),
      },
    ],
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
