/**
 * Configure le profil WhatsApp Business : logo, description, site, email, etc.
 * Le logo apparaît comme photo de profil du contact pour tous les utilisateurs.
 *
 * Usage 1 (logo + profil complet):
 *   WA_TOKEN="EAA..." LOGO_PATH="./logo.png" node setup-whatsapp-profile.js
 *
 * Usage 2 (sans logo, juste description/email/etc):
 *   WA_TOKEN="EAA..." node setup-whatsapp-profile.js
 *
 * Variables :
 *   WA_TOKEN     (obligatoire) Access Token Meta
 *   WA_PHONE_ID  (optionnel)   Phone Number ID. Défaut: 1040240149168335
 *   LOGO_PATH    (optionnel)   Chemin local vers le logo (jpg/png 640x640 recommandé, max 5MB)
 *   ABOUT        (optionnel)   Texte "À propos" (max 139 chars)
 *   DESCRIPTION  (optionnel)   Description longue (max 256 chars)
 *   EMAIL        (optionnel)   Email business
 *   WEBSITE      (optionnel)   URL du site (max 2 sites)
 *   ADDRESS      (optionnel)   Adresse
 *   VERTICAL     (optionnel)   Catégorie business (FOOD, AGRICULTURE, etc.)
 */

const fs = require("fs");
const path = require("path");

const token = process.env.WA_TOKEN;
const phoneId = process.env.WA_PHONE_ID || "1040240149168335";
const logoPath = process.env.LOGO_PATH;

if (!token) {
  console.error("ERREUR: WA_TOKEN manquant");
  process.exit(1);
}

const ABOUT = process.env.ABOUT || "SmartBerry — Notifications Berry Good Farms";
const DESCRIPTION = process.env.DESCRIPTION || "Système de notifications interne de Berry Good Farms : validations, alertes qualité et opérationnelles.";
const EMAIL = process.env.EMAIL || "contact@berrygood.ma";
const WEBSITE = process.env.WEBSITE || "https://berrygood-farms-dashboard.web.app";
const ADDRESS = process.env.ADDRESS || "Berry Good Farms, Maroc";
const VERTICAL = process.env.VERTICAL || "FARMING";

async function uploadLogo(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Logo non trouvé: ${filePath}`);
  }
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";

  // Step 1: Start an upload session
  const startUrl = `https://graph.facebook.com/v22.0/app/uploads?file_length=${buffer.length}&file_type=${encodeURIComponent(mime)}&access_token=${token}`;
  const start = await fetch(startUrl, { method: "POST" });
  const startData = await start.json();
  if (!start.ok) throw new Error("Échec création session upload: " + JSON.stringify(startData));
  const sessionId = startData.id;

  // Step 2: Upload the file binary
  const uploadUrl = `https://graph.facebook.com/v22.0/${sessionId}`;
  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      "file_offset": "0",
      "Content-Type": mime,
    },
    body: buffer,
  });
  const uploadData = await upload.json();
  if (!upload.ok) throw new Error("Échec upload binaire: " + JSON.stringify(uploadData));
  return uploadData.h; // handle to use in profile_picture_handle
}

async function updateProfile(payload) {
  const url = `https://graph.facebook.com/v22.0/${phoneId}/whatsapp_business_profile`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      ...payload,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}

(async () => {
  console.log(`\n🎨 Configuration du profil WhatsApp Business (${phoneId})\n`);

  const profile = {
    about: ABOUT,
    description: DESCRIPTION,
    email: EMAIL,
    websites: [WEBSITE],
    address: ADDRESS,
    vertical: VERTICAL,
  };

  // Upload logo if provided
  if (logoPath) {
    try {
      console.log(`  📸 Upload du logo: ${logoPath}`);
      const handle = await uploadLogo(logoPath);
      profile.profile_picture_handle = handle;
      console.log(`  ✅ Logo uploadé (handle reçu)`);
    } catch (err) {
      console.error(`  ❌ Échec upload logo: ${err.message}`);
      console.error(`     Le profil sera mis à jour sans logo.`);
    }
  } else {
    console.log("  ℹ️  Pas de logo (LOGO_PATH non fourni)");
  }

  console.log(`\n  Profil à appliquer:`);
  Object.entries(profile).forEach(([k, v]) => {
    if (k === "profile_picture_handle") console.log(`    ${k}: <handle>`);
    else console.log(`    ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  });

  try {
    const result = await updateProfile(profile);
    console.log(`\n✅ Profil mis à jour avec succès`);
    console.log(`   Réponse: ${JSON.stringify(result)}\n`);
    console.log(`👉 Vérifiez sur WhatsApp en envoyant un message test.`);
    console.log(`   Le logo et la description apparaîtront dans le profil du contact.`);
  } catch (err) {
    console.error(`\n❌ Échec mise à jour profil: ${err.message}\n`);
    process.exit(1);
  }
})();
