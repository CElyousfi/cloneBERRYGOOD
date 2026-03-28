/**
 * Script pour récupérer les données carburant depuis MyTotalFuelCard
 * Usage: node scripts/fetch-fuel-data.js
 *
 * Requiert un fichier .env avec:
 *   TOTAL_USERNAME=votre_identifiant
 *   TOTAL_PASSWORD=votre_mot_de_passe
 */

require("dotenv").config();
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.mytotalfuelcard.com/Client/app/index.html";

async function fetchFuelData() {
  const username = process.env.TOTAL_USERNAME;
  const password = process.env.TOTAL_PASSWORD;

  if (!username || !password) {
    console.error(
      "❌ Identifiants manquants. Créez un fichier .env avec TOTAL_USERNAME et TOTAL_PASSWORD"
    );
    process.exit(1);
  }

  console.log("🚀 Lancement du navigateur...");
  const browser = await chromium.launch({ headless: false }); // headless: false pour débugger
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    // 1. Aller sur la page de connexion
    console.log("📡 Connexion à MyTotalFuelCard...");
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });

    // 2. Remplir le formulaire de connexion
    await page.waitForSelector('input[type="text"], input[name*="user"], input[name*="login"], input[id*="user"], input[id*="login"]', { timeout: 15000 });

    // Trouver les champs de login (peut varier selon le site)
    const usernameInput = await page.$('input[type="text"], input[name*="user"], input[name*="login"], input[id*="user"], input[id*="login"]');
    const passwordInput = await page.$('input[type="password"]');

    if (!usernameInput || !passwordInput) {
      // Essayer avec des sélecteurs plus larges
      console.log("🔍 Recherche des champs de connexion...");
      const inputs = await page.$$("input");
      console.log(`   Trouvé ${inputs.length} champs input`);
      for (const input of inputs) {
        const type = await input.getAttribute("type");
        const name = await input.getAttribute("name");
        const id = await input.getAttribute("id");
        console.log(`   - type="${type}" name="${name}" id="${id}"`);
      }
      throw new Error("Champs de connexion non trouvés. Voir les logs ci-dessus.");
    }

    await usernameInput.fill(username);
    await passwordInput.fill(password);

    // 3. Soumettre le formulaire
    console.log("🔐 Envoi des identifiants...");
    const submitBtn = await page.$(
      'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Connexion"), .login-btn, #loginBtn'
    );
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await passwordInput.press("Enter");
    }

    // 4. Attendre que la page se charge après connexion
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    console.log("✅ Connecté !");

    // 5. Naviguer vers Transactions
    console.log("📊 Navigation vers Transactions...");
    const transactionsLink = await page.$(
      'a:has-text("Transactions"), a[href*="transaction"], li:has-text("Transactions")'
    );
    if (transactionsLink) {
      await transactionsLink.click();
      await page.waitForTimeout(3000);
    }

    // 6. Cliquer sur Exporter CSV
    console.log("📥 Export CSV...");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page
        .click('a:has-text("Exporter"), button:has-text("Exporter"), img[src*="csv"], a[href*="export"], .export-btn, a:has-text("CSV")')
        .catch(async () => {
          // Essayer de cliquer sur l'icône CSV en bas de page
          const csvIcon = await page.$('img[alt*="csv"], img[alt*="CSV"], img[src*="csv"]');
          if (csvIcon) await csvIcon.click();
        }),
    ]);

    // 7. Sauvegarder le fichier
    const outputDir = path.join(__dirname, "..", "data");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    const outputPath = path.join(outputDir, `fuel-transactions-${timestamp}.csv`);
    await download.saveAs(outputPath);

    console.log(`✅ Données exportées vers: ${outputPath}`);

    // 8. Aussi scraper les données visibles dans le tableau comme backup
    console.log("📋 Extraction des données du tableau...");
    const tableData = await scrapeTransactionsTable(page);
    if (tableData.length > 0) {
      const jsonPath = path.join(outputDir, `fuel-transactions-${timestamp}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(tableData, null, 2), "utf-8");
      console.log(`✅ Données JSON sauvegardées: ${jsonPath} (${tableData.length} transactions)`);
    }
  } catch (error) {
    console.error("❌ Erreur:", error.message);

    // Screenshot pour debug
    const screenshotPath = path.join(__dirname, "..", "data", "debug-screenshot.png");
    const dir = path.dirname(screenshotPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot de debug sauvegardé: ${screenshotPath}`);
  } finally {
    await browser.close();
    console.log("🏁 Terminé.");
  }
}

async function scrapeTransactionsTable(page) {
  const transactions = [];

  // Scraper toutes les pages
  let hasNextPage = true;
  let currentPage = 1;

  while (hasNextPage) {
    console.log(`   Page ${currentPage}...`);

    const rows = await page.$$("table tr");
    for (const row of rows) {
      const cells = await row.$$("td");
      if (cells.length >= 8) {
        const values = await Promise.all(cells.map((c) => c.innerText()));
        transactions.push({
          carte: values[0]?.trim(),
          date: values[1]?.trim(),
          ticket: values[2]?.trim(),
          lieu: values[3]?.trim(),
          produit: values[4]?.trim(),
          kms: values[5]?.trim(),
          quantite: values[6]?.trim(),
          montant: values[7]?.trim(),
          dateFacture: values[8]?.trim() || "",
          numFacture: values[9]?.trim() || "",
        });
      }
    }

    // Essayer de passer à la page suivante
    const nextBtn = await page.$('a:has-text(">"):not(:has-text(">>"))');
    if (nextBtn) {
      const isDisabled = await nextBtn.getAttribute("disabled");
      const className = await nextBtn.getAttribute("class");
      if (isDisabled || (className && className.includes("disabled"))) {
        hasNextPage = false;
      } else {
        await nextBtn.click();
        await page.waitForTimeout(2000);
        currentPage++;
      }
    } else {
      hasNextPage = false;
    }
  }

  return transactions;
}

fetchFuelData();
